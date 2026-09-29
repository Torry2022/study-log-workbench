import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { unifiedDataChannel, uniformTypeDescriptor, uniformDataStruct } from '@kit.ArkData';
import { apiClient, ApiUploadFile } from '../../common/network/ApiClient';
import { EditorImageData } from '../../common/editor/SourceEditor';

interface UploadedAsset { fileName: string; path: string; markdown: string; }
interface UploadAssetsResponse { assets: UploadedAsset[]; }

export class LogImageUpload {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) { this.context = context; }

  private imageFormat(bytes: Uint8Array): string {
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10]
      .every((value: number, index: number) => bytes[index] === value)) return 'png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    const head = Array.from(bytes.slice(0, 12)).map((value: number) => String.fromCharCode(value)).join('');
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
    throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');
  }

  receiveDrop(event: DragEvent): ApiUploadFile[] {
    const uris = event.getData().getRecords().map((record: unifiedDataChannel.UnifiedRecord) => {
      const type = record.getType();
      if (record.getTypes().includes(uniformTypeDescriptor.UniformDataType.FILE_URI)) {
        return (record.getEntry(uniformTypeDescriptor.UniformDataType.FILE_URI) as uniformDataStruct.FileUri).oriUri;
      }
      if (type === uniformTypeDescriptor.UniformDataType.IMAGE ||
        uniformTypeDescriptor.getTypeDescriptor(type).belongsTo(uniformTypeDescriptor.UniformDataType.IMAGE)) {
        return (record as unifiedDataChannel.Image).imageUri || (record as unifiedDataChannel.File).uri;
      }
      if (type === uniformTypeDescriptor.UniformDataType.FILE) return (record as unifiedDataChannel.File).uri;
      throw new Error('请拖入图片文件');
    });
    if (!uris.length || uris.length > 5) throw new Error('一次最多插入 5 张图片');
    const files: ApiUploadFile[] = [];
    let total = 0;
    try {
      for (let index = 0; index < uris.length; index++) {
        const source = fileIo.openSync(uris[index], fileIo.OpenMode.READ_ONLY);
        try {
          const size = fileIo.statSync(source.fd).size;
          total += size;
          if (size <= 0 || total > 20 * 1024 * 1024) throw new Error('图片不能为空，且总大小不能超过 20 MiB');
          const header = new ArrayBuffer(12);
          const length = fileIo.readSync(source.fd, header);
          const format = this.imageFormat(new Uint8Array(header, 0, length));
          const name = `incoming-image-${Date.now()}-${index + 1}.${format}`;
          const path = `${this.context.cacheDir}/${name}`;
          const destination = fileIo.openSync(path,
            fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
          files.push({ path, name, contentType: `image/${format}` });
          try { fileIo.copyFileSync(source.fd, destination.fd); }
          finally { fileIo.closeSync(destination); }
        } finally { fileIo.closeSync(source); }
      }
      return files;
    } catch (error) {
      this.clear(files);
      throw error instanceof Error ? error : new Error('图片读取失败');
    }
  }

  private cachePicked(uri: string, index: number): ApiUploadFile {
    const extension = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
      .find((candidate: string) => uri.split('?')[0].toLowerCase().endsWith(candidate)) || '.jpg';
    const name = `log-image-${Date.now()}-${index}${extension}`;
    const path = `${this.context.cacheDir}/${name}`;
    const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
    try {
      const destination = fileIo.openSync(path,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try { fileIo.copyFileSync(source.fd, destination.fd); }
      catch (error) {
        try { fileIo.unlinkSync(path); } catch (_) {}
        throw error instanceof Error ? error : new Error('无法复制所选图片');
      }
      finally { fileIo.closeSync(destination); }
    } finally { fileIo.closeSync(source); }
    return { path, name, contentType: extension === '.png' ? 'image/png' :
      extension === '.gif' ? 'image/gif' : extension === '.webp' ? 'image/webp' : 'image/jpeg' };
  }

  private cachePasted(images: EditorImageData[], files: ApiUploadFile[]): void {
    const decoder = new util.Base64Helper();
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime.slice(6);
      const name = `log-paste-${Date.now()}-${index}.${extension}`;
      const path = `${this.context.cacheDir}/${name}`;
      const file = fileIo.openSync(path,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      files.push({ path, name, contentType: image.mime });
      try {
        for (const chunk of image.chunks) {
          const bytes = decoder.decodeSync(chunk);
          fileIo.writeSync(file.fd, bytes.buffer as ArrayBuffer);
        }
      } finally { fileIo.closeSync(file); }
    }
  }

  async pick(): Promise<ApiUploadFile[]> {
    const viewPicker = new picker.DocumentViewPicker(this.context);
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 5;
    options.fileSuffixFilters = ['图片|.png,.jpg,.jpeg,.gif,.webp'];
    const uris = await viewPicker.select(options);
    const files: ApiUploadFile[] = [];
    try {
      for (let index = 0; index < uris.length; index++) files.push(this.cachePicked(uris[index], index));
      return files;
    } catch (error) { this.clear(files); throw error instanceof Error ? error : new Error('无法读取所选图片'); }
  }

  async paste(images: EditorImageData[]): Promise<ApiUploadFile[]> {
    const files: ApiUploadFile[] = [];
    try { this.cachePasted(images, files); return files; }
    catch (error) { this.clear(files); throw error instanceof Error ? error : new Error('无法读取粘贴的图片'); }
  }

  async upload(files: ApiUploadFile[]): Promise<string> {
    if (!files.length || files.length > 5) throw new Error('每次请选择 1 至 5 张图片');
    const response = await apiClient.postFiles<UploadAssetsResponse>('/assets/upload', files);
    if (!response.assets || response.assets.length !== files.length ||
      response.assets.some((asset: UploadedAsset) => typeof asset.markdown !== 'string')) {
      throw new Error('图片上传响应格式异常');
    }
    return response.assets.map((asset: UploadedAsset) => asset.markdown).join('\n\n');
  }

  clear(files: ApiUploadFile[]): void {
    for (const file of files) {
      try { fileIo.unlinkSync(file.path); } catch (_) { /* Cache file may already be gone. */ }
    }
  }
}

import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { apiClient, ApiUploadFile } from '../../common/network/ApiClient';
import { EditorImageData } from '../../common/editor/SourceEditor';

interface UploadedAsset { fileName: string; path: string; markdown: string; }
interface UploadAssetsResponse { assets: UploadedAsset[]; }

export class LogImageUpload {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) { this.context = context; }

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

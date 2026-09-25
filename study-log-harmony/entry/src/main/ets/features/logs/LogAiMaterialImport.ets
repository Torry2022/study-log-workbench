import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { apiClient, ApiUploadFile } from '../../common/network/ApiClient';

interface ExtractedDocument { fileName: string; text: string; warnings: string[]; }
interface ExtractedDocumentResponse { document: ExtractedDocument; }

export class LogAiMaterialImport {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }

  async pickAndExtract(): Promise<ExtractedDocument | undefined> {
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 1;
    options.fileSuffixFilters = ['材料|.txt,.md,.pdf,.docx,.pptx'];
    const uris = await new picker.DocumentViewPicker(this.context).select(options);
    if (uris.length === 0) return undefined;
    const extension = uris[0].split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (!['txt', 'md', 'pdf', 'docx', 'pptx'].includes(extension)) throw new Error('不支持的材料格式');
    const name = `ai-material-${Date.now()}.${extension}`;
    const path = `${this.context.cacheDir}/${name}`;
    const source = fileIo.openSync(uris[0], fileIo.OpenMode.READ_ONLY);
    try {
      const target = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try { fileIo.copyFileSync(source.fd, target.fd); }
      finally { fileIo.closeSync(target); }
    } finally { fileIo.closeSync(source); }
    try {
      const file: ApiUploadFile = { path, name, contentType: 'application/octet-stream' };
      const response = await apiClient.postFiles<ExtractedDocumentResponse>('/materials/extract', [file]);
      if (!response.document || typeof response.document.text !== 'string') throw new Error('材料解析响应格式异常');
      return response.document;
    } finally { try { fileIo.unlinkSync(path); } catch (_) {} }
  }
}

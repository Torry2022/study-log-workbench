import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { apiClient, ApiUploadFile } from '../../common/network/ApiClient';
import { cacheImportUri, NoteImportFile } from '../../common/files/NoteImportFile';

interface ExtractedDocument { fileName: string; text: string; warnings: string[]; }
interface ExtractedDocumentResponse { document: ExtractedDocument; }
export interface ImportedAiMaterials { text: string; warnings: string[]; }

export class LogAiMaterialImport {
  private context: common.UIAbilityContext;
  constructor(context: common.UIAbilityContext) { this.context = context; }

  async pickAndExtract(current: () => boolean): Promise<ImportedAiMaterials | undefined> {
    const options = new picker.DocumentSelectOptions();
    options.maxSelectNumber = 5;
    options.fileSuffixFilters = ['文档|.txt,.md,.markdown,.pdf,.docx,.pptx'];
    const uris = await new picker.DocumentViewPicker(this.context).select(options);
    if (uris.length === 0 || !current()) return undefined;
    const materials: string[] = [];
    const warnings: string[] = [];
    for (let index = 0; index < uris.length && index < 5; index++) {
      if (!current()) return undefined;
      let cached: NoteImportFile | undefined;
      try {
        cached = cacheImportUri(this.context, uris[index], index);
        const upload: ApiUploadFile = { path: cached.path, name: cached.name, contentType: cached.contentType };
        const response = await apiClient.postFiles<ExtractedDocumentResponse>('/materials/extract', [upload]);
        if (!current()) return undefined;
        if (!response.document || typeof response.document.text !== 'string') {
          throw new Error('材料解析响应格式异常');
        }
        materials.push(`[文件：${response.document.fileName}]\n${response.document.text}`);
        warnings.push(...(response.document.warnings || []));
      } catch (error) {
        if (!current()) return undefined;
        warnings.push(error instanceof Error ? error.message : '文件导入失败');
      } finally {
        if (cached) { try { fileIo.unlinkSync(cached.path); } catch (_) {} }
      }
    }
    return { text: materials.join('\n\n'), warnings };
  }
}

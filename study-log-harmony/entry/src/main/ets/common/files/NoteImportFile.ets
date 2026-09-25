import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';

export interface NoteImportFile {
  path: string;
  name: string;
  size: number;
  contentType: string;
}

export function cacheImportUri(context: common.UIAbilityContext, uri: string, index: number): NoteImportFile {
  const raw = uri.split('?')[0].split('/').pop() || `材料-${index + 1}.txt`;
  const name = decodeURIComponent(raw).replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.(txt|md|markdown|pdf|docx|pptx)$/i.test(name)) throw new Error('不支持的材料格式');
  const path = `${context.cacheDir}/note-import-${Date.now()}-${index}-${name}`;
  const source = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
  try {
    const target = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
    try { fileIo.copyFileSync(source.fd, target.fd); }
    finally { fileIo.closeSync(target); }
  } finally { fileIo.closeSync(source); }
  const size = fileIo.statSync(path).size;
  if (size < 1 || size > 20 * 1024 * 1024) {
    fileIo.unlinkSync(path);
    throw new Error('材料为空或超过 20 MB');
  }
  return { path, name, size, contentType: 'application/octet-stream' };
}

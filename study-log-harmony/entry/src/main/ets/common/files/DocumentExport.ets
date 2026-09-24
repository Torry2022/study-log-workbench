import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';

export async function saveExport(context: common.UIAbilityContext, fileName: string,
  data: ArrayBuffer, current: () => boolean): Promise<boolean> {
  if (!current()) return false;
  const options = new picker.DocumentSaveOptions();
  options.newFileNames = [fileName];
  const uris = await new picker.DocumentViewPicker(context).save(options);
  if (!current() || uris.length === 0) return false;
  const file = fileIo.openSync(uris[0], fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
  try { fileIo.writeSync(file.fd, data); } finally { fileIo.closeSync(file); }
  return true;
}

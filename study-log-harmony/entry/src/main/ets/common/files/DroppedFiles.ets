import { unifiedDataChannel, uniformDataStruct, uniformTypeDescriptor } from '@kit.ArkData';

export function droppedFileUris(data: unifiedDataChannel.UnifiedData): string[] {
  const uris: string[] = [];
  data.getRecords().forEach((record: unifiedDataChannel.UnifiedRecord) => {
    let uri = '';
    if (record.getTypes().includes(uniformTypeDescriptor.UniformDataType.FILE_URI)) {
      const file = record.getEntry(uniformTypeDescriptor.UniformDataType.FILE_URI) as uniformDataStruct.FileUri;
      uri = file.oriUri;
    } else {
      uri = (record as unifiedDataChannel.File).uri;
    }
    if (uri && !uris.includes(uri)) uris.push(uri);
  });
  return uris;
}

import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

// Only the non-secret current-instance pointer lives here. Credentials stay in AssetStore.
export class ConnectionSelectionStore {
  private path: string;

  constructor(directory: string) {
    this.path = directory + '/public-current-connection.json';
  }

  read(): string | undefined {
    if (!fileIo.accessSync(this.path)) return undefined;
    return fileIo.readTextSync(this.path);
  }

  write(raw: string): void {
    const pending = this.path + '.pending';
    const file = fileIo.openSync(pending, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
    try {
      const length = fileIo.writeSync(file.fd, raw);
      if (length !== new util.TextEncoder().encodeInto(raw).length) throw new Error('连接设置写入不完整');
      fileIo.fsyncSync(file.fd);
    } finally { fileIo.closeSync(file); }
    // No await or fallible operation follows this commit point before activation.
    fileIo.renameSync(pending, this.path);
  }
}

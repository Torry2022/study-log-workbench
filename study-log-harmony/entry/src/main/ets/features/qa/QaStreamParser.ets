// Buffers transport chunks only. Event semantics belong to the session controller.
export class QaStreamParser {
  private buffer: string = '';

  reset(): void { this.buffer = ''; }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const blocks: string[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary) {
      blocks.push(this.buffer.slice(0, boundary.index).replace(/\r\n/g, '\n'));
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
    }
    return blocks;
  }
}

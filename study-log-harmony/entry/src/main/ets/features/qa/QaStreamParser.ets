// Buffers transport chunks only. Event semantics belong to the session controller.
export class QaStreamParser {
  private buffer: string = '';

  reset(): void { this.buffer = ''; }

  push(chunk: string): string[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const blocks: string[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      blocks.push(this.buffer.slice(0, boundary));
      this.buffer = this.buffer.slice(boundary + 2);
      boundary = this.buffer.indexOf('\n\n');
    }
    return blocks;
  }
}

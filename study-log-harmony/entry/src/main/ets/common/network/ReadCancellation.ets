// A request owner cancels only its own read, never other pages' sessions.
export class ReadCancellation {
  cancelled: boolean = false;
  private onCancel: () => void = () => {};

  bind(action: () => void): void {
    if (this.cancelled) action();
    else this.onCancel = action;
  }

  release(): void { this.onCancel = () => {}; }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.onCancel();
    this.release();
  }

  check(): void {
    if (this.cancelled) throw new Error('读取已取消');
  }
}

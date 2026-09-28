import { image } from '@kit.ImageKit';

@Observed
export class ReadingTransitionCoordinator {
  animating: boolean = false;
  snapshot: image.PixelMap | undefined = undefined;
  viewportReady: boolean = false;
  motionFinished: boolean = false;
  revision: number = 0;
  private timer: number = -1;
  private renderTimer: number = -1;
  private ready: () => void = () => {};

  begin(): number {
    this.animating = true;
    const revision = ++this.revision;
    this.timer = setTimeout(() => { if (revision === this.revision) this.clear(); }, 1200);
    return revision;
  }

  async install(snapshot: image.PixelMap, revision: number): Promise<void> {
    if (revision !== this.revision) { snapshot.release(); return; }
    await new Promise<void>((resolve) => {
      this.ready = resolve;
      this.snapshot = snapshot;
      this.renderTimer = setTimeout(resolve, 200);
    });
    if (revision === this.revision) {
      clearTimeout(this.renderTimer); this.renderTimer = -1;
      this.ready = () => {};
    }
  }

  rendered(): void { this.ready(); }

  finish(): void {
    if (this.animating && this.motionFinished && this.viewportReady) this.clear();
  }

  clear(): void {
    this.revision += 1;
    clearTimeout(this.timer); this.timer = -1;
    clearTimeout(this.renderTimer); this.renderTimer = -1;
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    this.animating = false;
    this.ready(); this.ready = () => {};
    snapshot?.release();
  }
}

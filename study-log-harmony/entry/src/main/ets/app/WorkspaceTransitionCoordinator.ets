import { image } from '@kit.ImageKit';

export interface WorkspaceTransitionView {
  tab: () => number;
  canCapture: (kind: string) => boolean;
  capture: (kind: string) => Promise<image.PixelMap>;
  fade: (update: () => void, finished: () => void) => void;
}

@Observed
export class WorkspaceTransitionCoordinator {
  snapshot: image.PixelMap | undefined = undefined;
  opacity: number = 1;
  waitingKind: string = '';
  task: Promise<void> | undefined = undefined;
  kind: string = '';
  private covered: boolean = false;
  private revision: number = 0;
  private timer: number = -1;
  private ready: () => void = () => {};
  private deadline: () => void = () => {};
  private view: WorkspaceTransitionView;

  constructor(view: WorkspaceTransitionView) { this.view = view; }

  cover(kind: string): Promise<void> {
    if (this.task) return this.task;
    this.waitingKind = kind;
    const revision = this.revision;
    const deadline = new Promise<void>((resolve) => {
      this.deadline = resolve;
      this.timer = setTimeout(() => {
        if (revision !== this.revision) return;
        this.clear();
        this.waitingKind = kind;
      }, 200);
    });
    const task = Promise.race([this.capture(kind, revision), deadline]).finally(() => {
      if (this.task !== task) return;
      clearTimeout(this.timer);
      this.timer = -1;
      this.task = undefined;
      this.deadline = () => {};
    });
    this.task = task;
    return task;
  }

  private async capture(kind: string, revision: number): Promise<void> {
    if (!this.view.canCapture(kind) || this.snapshot) return;
    const tab = this.view.tab();
    try {
      const snapshot = await this.view.capture(kind);
      if (this.view.tab() !== tab || revision !== this.revision) { snapshot.release(); return; }
      this.kind = kind;
      this.covered = false;
      this.opacity = 1;
      await new Promise<void>((resolve) => { this.ready = resolve; this.snapshot = snapshot; });
      if (revision === this.revision) this.covered = true;
    } catch (_) {
      if (revision === this.revision) this.kind = '';
    }
  }

  rendered(): void { this.ready(); }

  finish(kind: string): void {
    if (this.waitingKind === kind) {
      this.waitingKind = '';
      clearTimeout(this.timer);
    }
    if (!this.snapshot || !this.covered || kind !== this.kind) return;
    clearTimeout(this.timer);
    this.covered = false;
    const snapshot = this.snapshot;
    this.view.fade(() => this.opacity = 0, () => { if (this.snapshot === snapshot) this.clear(); });
  }

  clear(): void {
    this.waitingKind = '';
    clearTimeout(this.timer);
    this.timer = -1;
    this.revision += 1;
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    this.kind = '';
    this.covered = false;
    this.ready(); this.ready = () => {};
    this.deadline(); this.deadline = () => {};
    this.task = undefined;
    snapshot?.release();
  }
}

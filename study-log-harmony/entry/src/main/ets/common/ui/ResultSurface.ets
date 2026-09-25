import { image } from '@kit.ImageKit';
import { UIContext } from '@kit.ArkUI';
import { FrameAction } from './FrameAction';

// Keep the last rendered viewport until its replacement has completed a frame.
// Capture asynchronously: sidebar input must never wait on a synchronous snapshot.
@Observed
export class ResultSurfaceController {
  snapshot: image.PixelMap | undefined = undefined;
  snapshotRevision: number = 0;
  opacity: number = 1;
  topInset: number = 0;
  private revision: number = 0;
  private commit: (() => void) | undefined = undefined;
  private retired: image.PixelMap[] = [];
  private commitTimer: number = -1;

  async replace(context: UIContext, id: string, update: () => void, isCurrent: () => boolean,
    topInset: number = 0): Promise<void> {
    const revision = ++this.revision;
    clearTimeout(this.commitTimer);
    this.commit = undefined;
    // A local result update must not depend indefinitely on screenshot completion.
    this.commitTimer = setTimeout(() => {
      if (revision !== this.revision) return;
      this.clear();
      if (isCurrent()) update();
    }, 100);
    let captured: image.PixelMap | undefined = undefined;
    try {
      const snapshot = await context.getComponentSnapshot().get(id, { waitUntilRenderFinished: true });
      captured = snapshot;
      if (topInset > 0) {
        const size = snapshot.getImageInfoSync().size;
        const top = Math.min(size.height - 1, Math.round(context.vp2px(topInset)));
        await snapshot.crop({ x: 0, y: top, size: { width: size.width, height: size.height - top } });
      }
      if (revision !== this.revision || !isCurrent()) {
        snapshot.release();
        if (revision === this.revision) this.clear();
        return;
      }
      if (this.snapshot) this.retired.push(this.snapshot);
      this.opacity = 1;
      this.topInset = topInset;
      this.commit = () => { if (isCurrent()) update(); };
      this.snapshotRevision = revision;
      this.snapshot = snapshot;
      captured = undefined;
    } catch (_) {
      captured?.release();
      if (revision !== this.revision || !isCurrent()) return;
      this.clear();
      update();
    }
  }

  ready(context: UIContext, snapshot: image.PixelMap): void {
    if (snapshot !== this.snapshot || !this.commit) return;
    const update = this.commit;
    this.commit = undefined;
    clearTimeout(this.commitTimer);
    this.retired.forEach((item: image.PixelMap) => item.release());
    this.retired = [];
    update();
    const revision = this.revision;
    context.postFrameCallback(new FrameAction(() => {
      if (revision !== this.revision || snapshot !== this.snapshot) return;
      context.animateTo({ duration: 140, curve: Curve.EaseOut, onFinish: () => {
        if (revision === this.revision) this.clear();
      } }, () => this.opacity = 0);
    }));
  }

  failed(snapshot: image.PixelMap): void {
    if (snapshot !== this.snapshot) return;
    const update = this.commit;
    this.clear();
    update?.();
  }

  clear(): void {
    clearTimeout(this.commitTimer);
    this.revision += 1;
    this.commit = undefined;
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    snapshot?.release();
    this.retired.forEach((item: image.PixelMap) => item.release());
    this.retired = [];
  }
}

@Component
export struct ResultSurfaceCover {
  @ObjectLink controller: ResultSurfaceController;

  @Builder
  private cover(snapshot: image.PixelMap) {
    Image(snapshot).width('100%').height('100%').objectFit(ImageFit.Fill).syncLoad(true)
      .id('result_surface_cover')
      .opacity(this.controller.opacity)
      .onComplete(() => this.controller.ready(this.getUIContext(), snapshot))
      .onError(() => this.controller.failed(snapshot))
      .hitTestBehavior(HitTestMode.None)
  }

  build() {
    Column() {
      if (this.controller.snapshot) {
        Row().width('100%').height(this.controller.topInset)
        Stack() {
          // A new snapshot needs its own Image and completion callback, even during an active fade.
          ForEach([this.controller.snapshot], (snapshot: image.PixelMap) => {
            this.cover(snapshot)
          }, () => this.controller.snapshotRevision.toString())
        }.width('100%').layoutWeight(1)
      }
    }.width('100%').height('100%').hitTestBehavior(HitTestMode.None)
  }
}

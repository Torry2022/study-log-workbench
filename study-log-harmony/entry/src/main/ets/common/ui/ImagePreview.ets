import { image } from '@kit.ImageKit';
import { WORKSPACE_TIPS } from './WorkspaceTips';
import { util } from '@kit.ArkTS';
import { iconTint } from './IconTint';

@Component
export struct ImagePreview {
  @Prop source: string = '';
  onClose: () => void = () => {};
  onReady: () => void = () => {};
  @State private zoom: number = 1;
  @State private offsetX: number = 0;
  @State private offsetY: number = 0;
  private startZoom: number = 1;
  private startX: number = 0;
  private startY: number = 0;
  @State private bitmap: image.PixelMap | undefined = undefined;
  @State private failed: boolean = false;
  private disposed: boolean = false;
  @State private viewportWidth: number = 0;
  @State private viewportHeight: number = 0;
  @State private naturalWidth: number = 0;
  @State private naturalHeight: number = 0;

  private fittedScale(): number {
    if (this.naturalWidth <= 0 || this.naturalHeight <= 0) return 0;
    return Math.max(0, Math.min(2,
      Math.min(this.viewportWidth * 0.8, this.viewportWidth - 60, 1440) / this.naturalWidth,
      (this.viewportHeight - 132) / this.naturalHeight));
  }

  aboutToAppear(): void {
    if (this.source.startsWith('data:')) this.decodeImage();
  }

  private async decodeImage(): Promise<void> {
    try {
      const bytes = new util.Base64Helper().decodeSync(this.source.substring(this.source.indexOf(',') + 1));
      const decoder = image.createImageSource(bytes.buffer as ArrayBuffer);
      try {
        const bitmap = await decoder.createPixelMap();
        if (this.disposed) bitmap.release();
        else this.bitmap = bitmap;
      } finally {
        decoder.release();
      }
    } catch (_) {
      this.failed = true;
      if (!this.disposed) this.onReady();
    }
  }

  aboutToDisappear(): void {
    this.disposed = true;
    this.bitmap?.release();
  }

  private setZoom(value: number): void {
    this.zoom = Math.max(0.25, Math.min(5, value));
    if (this.zoom <= 1) {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Stack() {
      Image(this.bitmap || (this.source.startsWith('data:') ? '' : this.source))
        .id('image_preview_content')
        .width(Math.max(1, this.naturalWidth * this.fittedScale()))
        .height(Math.max(1, this.naturalHeight * this.fittedScale())).objectFit(ImageFit.Contain)
        .opacity(this.fittedScale() > 0 ? 1 : 0)
        .onComplete((event) => {
          if (event && event.width > 0 && event.height > 0) {
            this.naturalWidth = event.width;
            this.naturalHeight = event.height;
          }
        })
        .onAreaChange((_old: Area, area: Area) => {
          if (this.fittedScale() > 0 && Number(area.width) > 1 && Number(area.height) > 1) this.onReady();
        })
        .onError(() => {
          if (!this.source.startsWith('data:')) {
            this.failed = true;
            this.onReady();
          }
        })
        .scale({ x: this.zoom, y: this.zoom })
        .translate({ x: this.offsetX, y: this.offsetY })
      if (this.failed) {
        Text('图片无法加载').fontColor($r('app.color.on_dark'))
          .width('100%').height('100%').textAlign(TextAlign.Center)
      }
      }.width('100%').height('100%').clip(true).padding({ top: 58, bottom: 58, left: 30, right: 30 })
      Button({ type: ButtonType.Circle }) {
        Image($r('app.media.x')).width(18).height(18)
          .colorFilter(iconTint($r('app.color.on_dark')))
      }.id('image_preview_close').width(40).height(40).padding(0)
        .backgroundColor($r('app.color.image_preview_control'))
        .border({ width: 1, color: $r('app.color.image_preview_border') }).borderRadius(20)
        .margin({ top: 18, right: 18 }).accessibilityText('关闭图片').bindTips('关闭图片', WORKSPACE_TIPS).onClick(this.onClose)
      Column() {
        Blank()
        Text(`${Math.round(this.zoom * 100)}%`).id('image_preview_zoom').fontFamily('monospace').fontSize(12)
          .fontColor($r('app.color.on_dark_soft')).constraintSize({ minWidth: 54 })
          .textAlign(TextAlign.Center).padding({ top: 7, bottom: 7, left: 10, right: 10 })
          .backgroundColor($r('app.color.image_preview_control'))
          .border({ width: 1, color: $r('app.color.image_preview_border') }).borderRadius(8)
      }.height('100%').padding({ bottom: 18, right: 18 }).hitTestBehavior(HitTestMode.None)
    }.width('100%').height('100%').clip(true)
      .onAreaChange((_old: Area, area: Area) => {
        this.viewportWidth = Number(area.width);
        this.viewportHeight = Number(area.height);
      })
      .gesture(GestureGroup(GestureMode.Parallel,
        PinchGesture().onActionStart(() => this.startZoom = this.zoom)
          .onActionUpdate((event: GestureEvent) => this.setZoom(this.startZoom * event.scale)),
        PanGesture().onActionStart(() => {
          this.startX = this.offsetX;
          this.startY = this.offsetY;
        }).onActionUpdate((event: GestureEvent) => {
          if (this.zoom > 1) {
            this.offsetX = this.startX + event.offsetX;
            this.offsetY = this.startY + event.offsetY;
          }
        }),
        TapGesture({ count: 2 }).onAction(() => this.setZoom(this.zoom > 1 ? 1 : 2))
      ))
      .onAxisEvent((event: AxisEvent) => this.setZoom(this.zoom * Math.exp(-event.getVerticalAxisValue() * 0.002)))
      .onClick((event: ClickEvent) => {
        const halfWidth = this.naturalWidth * this.fittedScale() * this.zoom / 2;
        const halfHeight = this.naturalHeight * this.fittedScale() * this.zoom / 2;
        if (Math.abs(event.x - this.viewportWidth / 2 - this.offsetX) > halfWidth ||
          Math.abs(event.y - this.viewportHeight / 2 - this.offsetY) > halfHeight) this.onClose();
      })
  }
}

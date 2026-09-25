import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { apiClient } from '../../../common/network/ApiClient';

@Component
export struct NoteImage {
  @Prop source: string = '';
  @Prop alt: string = '';
  @State private bitmap?: image.PixelMap = undefined;
  @State private failed: boolean = false;
  private dataUrl: string = '';
  private disposed: boolean = false;

  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.disposed = true; this.bitmap?.release(); }

  private async load(): Promise<void> {
    const path = this.source.replace(/^(\.\.\/|\.\/)?assets\//, '');
    if (path === this.source || path.split('/').some((part: string) => part === '..')) {
      this.failed = !/^https:\/\//.test(this.source);
      return;
    }
    try {
      const bytes = await apiClient.download('/assets/' + path.split('/').map((part: string) => encodeURIComponent(part)).join('/'));
      const decoder = image.createImageSource(bytes);
      try {
        const bitmap = await decoder.createPixelMap();
        if (this.disposed) { bitmap.release(); return; }
        this.dataUrl = 'data:image/' + (path.endsWith('.svg') ? 'svg+xml' : path.split('.').pop()) + ';base64,' +
          new util.Base64Helper().encodeToStringSync(new Uint8Array(bytes));
        this.bitmap = bitmap;
      } finally { decoder.release(); }
    } catch (_) { if (!this.disposed) this.failed = true; }
  }

  build() {
    if (this.failed) {
      Text(this.alt ? `图片加载失败：${this.alt}` : '图片加载失败').fontSize(12).fontColor($r('app.color.muted'))
    } else if (this.bitmap || /^https:\/\//.test(this.source)) {
      Image(this.bitmap || (/^https:\/\//.test(this.source) ? this.source : ''))
        .width('100%').constraintSize({ maxHeight: 360 }).objectFit(ImageFit.Contain)
        .accessibilityText(this.alt || '随记图片').onError(() => this.failed = true)
        .onClick(() => {
          const source = this.dataUrl || (/^https:\/\//.test(this.source) ? this.source : '');
          if (source) AppStorage.setOrCreate('previewImageSource', source);
        })
    } else {
      LoadingProgress().width(24).height(24).color($r('app.color.primary'))
    }
  }
}

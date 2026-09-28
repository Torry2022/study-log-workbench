import { WorkspaceBreakpoint } from '../AppConfig';
import { workspaceSerifFamily } from './Typography';

@Component
export struct EmptyState {
  @Prop embedded: boolean = false;
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop symbol: Resource = $r('sys.symbol.doc_text');
  @Prop title: string = '';
  @Prop description: string = '';

  build() {
    Column({ space: this.embedded ? 0 : 12 }) {
      SymbolGlyph(this.symbol)
        .fontSize(38)
        .fontColor([$r('app.color.muted_soft')])
      Text(this.title)
        .fontFamily(workspaceSerifFamily(this.workspaceBreakpoint))
        .fontSize(23)
        .lineHeight(this.embedded ? 30 : undefined)
        .margin({ top: this.embedded ? 8 : 0 })
        .fontWeight(FontWeight.Regular)
        .fontColor($r('app.color.ink'))
      if (this.description) {
        Text(this.description)
          .fontSize(14)
          .margin({ top: this.embedded ? 4 : 0 })
          .lineHeight(22)
          .fontColor($r('app.color.muted'))
          .textAlign(TextAlign.Center)
          .maxLines(3)
      }
    }
    .width('100%')
    .layoutWeight(this.embedded ? 0 : 1)
    .justifyContent(FlexAlign.Center)
    .padding(this.embedded ? 0 : 32)
  }
}

@Component
export struct LoadFailure {
  @Prop title: string = '读取失败';
  @Prop message: string = '';
  onRetry: () => void = () => {};

  build() {
    Column({ space: 12 }) {
      EmptyState({ embedded: true, symbol: $r('sys.symbol.exclamationmark_circle'),
        title: this.title, description: this.message })
      Button('重试', { type: ButtonType.Normal }).height(36).padding({ left: 20, right: 20 })
        .fontSize(14).backgroundColor($r('app.color.surface_soft')).fontColor($r('app.color.body'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .onClick(this.onRetry)
    }.width('100%').height('100%').padding(32).justifyContent(FlexAlign.Center)
  }
}

@Component
export struct InlineStatus {
  @Prop text: string = '';
  @Prop error: boolean = false;
  @Prop loading: boolean = false;
  @Prop retry: boolean = false;
  @Prop retryLabel: string = '重试';
  onRetry: () => void = () => {};

  build() {
    if (this.text) {
      Row({ space: 8 }) {
        if (this.loading) {
          LoadingProgress().width(16).height(16).color($r('app.color.primary'))
        } else {
        SymbolGlyph(this.error ? $r('sys.symbol.exclamationmark_circle') : $r('sys.symbol.checkmark_circle'))
          .fontSize(16)
          .fontColor([this.error ? $r('app.color.error') : $r('app.color.success')])
        }
        Text(this.text)
          .fontSize(13)
          .fontColor(this.error ? $r('app.color.error') : $r('app.color.body'))
          .maxLines(2)
          .layoutWeight(1)
        if (this.retry) {
          Button(this.retryLabel, { type: ButtonType.Normal }).height(36).padding({ left: 12, right: 12 })
            .fontSize(13).backgroundColor($r('app.color.surface_soft')).fontColor($r('app.color.body'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .onClick(this.onRetry)
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 9, bottom: 9 })
      .backgroundColor(this.error ? $r('app.color.error_surface') : $r('app.color.success_surface'))
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
    }
  }
}

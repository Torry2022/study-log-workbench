import { webview } from '@kit.ArkWeb';
import { KeyCode } from '@kit.InputKit';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';

@Component
export struct LogHighlightReview {
  @Prop original: string = '';
  @Prop highlighted: string = '';
  @Prop date: string = '';
  @Prop available: boolean = false;
  @Prop themePreference: string = 'system';
  @StorageProp('systemTheme') private systemTheme: string = 'light';
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @State private maximized: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  onClose: () => void = () => {};
  onApply: () => void = () => {};

  private toggleMaximized(): void {
    this.getUIContext().animateTo({ duration: 260, curve: Curve.EaseInOut }, () => {
      this.maximized = !this.maximized;
    });
  }

  private render(): void {
    const dark = this.themePreference === 'dark' || (this.themePreference === 'system' && this.systemTheme === 'dark');
    this.controller.runJavaScript(`window.renderBackup(${JSON.stringify(this.original)},${JSON.stringify(this.highlighted)},${dark});` +
      `document.querySelector('header>div:first-child').textContent='当前草稿';` +
      `document.querySelector('header>div:last-child').textContent='标注结果';`);
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Stack().width('100%').height('100%').backgroundColor($r('app.color.scrim'))
        .onClick(this.onClose)
      Column() {
        Row({ space: 12 }) {
          Text('重点标注对照').fontSize(18).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
          Text(this.date).fontSize(12).fontColor($r('app.color.muted'))
          if (this.breakpoint !== WorkspaceBreakpoint.COMPACT) {
            ToolbarAction({ label: this.maximized ? '还原标注对照窗口' : '最大化标注对照窗口', showLabel: false,
              useSymbol: true, symbol: this.maximized ? $r('sys.symbol.arrow_down_right_and_arrow_up_left') :
                $r('sys.symbol.arrow_up_left_and_arrow_down_right'),
              onAction: () => this.toggleMaximized() }).id('log_ai_review_maximize')
          }
          ToolbarAction({ label: '关闭标注对照', showLabel: false, useSymbol: true,
            symbol: $r('sys.symbol.xmark'), onAction: this.onClose }).id('log_ai_review_close')
        }.width('100%').padding(16)
        Web({ src: $rawfile('editor/backup.html'), controller: this.controller, renderMode: RenderMode.SYNC_RENDER })
          .width('100%').layoutWeight(1).javaScriptAccess(true).domStorageAccess(false).onlineImageAccess(false)
          .backgroundColor($r('app.color.canvas')).monopolizeEvents(true)
          .onOverrideUrlLoading(() => true).onPageEnd(() => this.render())
        Row({ space: 12 }) {
          Text('确认后仅替换当前草稿，不会自动保存。').layoutWeight(1).fontSize(12).fontColor($r('app.color.muted'))
          ToolbarAction({ label: '应用标注', icon: $r('app.media.check'), primary: true,
            available: this.available, onAction: this.onApply }).id('log_ai_apply_highlight')
        }.width('100%').padding(16)
      }.width(this.maximized ? '100%' : '92%')
        .constraintSize({ maxWidth: this.maximized ? '100%' : 1120 }).height(this.maximized ? '100%' : '85%')
        .backgroundColor($r('app.color.canvas')).borderRadius(this.maximized ? 0 : 12).clip(true)
        .border({ width: 1, color: $r('app.color.hairline') }).onClick(() => {})
    }.width('100%').height('100%').id('log_ai_review')
      .onKeyEvent((event: KeyEvent) => {
        if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
          event.stopPropagation(); this.onClose();
        }
      })
  }
}

import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { FrameAction } from '../../common/ui/FrameAction';
import { floatingSurfaceTransition } from '../../common/ui/WorkspaceMotion';

@Component
export struct DesktopThemePanel {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop themePreference: string = 'system';
  onSetTheme: (value: string) => void = () => {};
  onClose: () => void = () => {};

  private focusRevision: number = 0;

  private focusPanel(): void {
    const revision = ++this.focusRevision;
    this.getUIContext().postFrameCallback(new FrameAction(() => {
      if (revision === this.focusRevision) focusControl.requestFocus('desktop_theme_close');
    }));
  }

  aboutToDisappear(): void { this.focusRevision++; }

  @Builder
  private themeChoice(value: string, label: string, symbol: Resource = $r('sys.symbol.sun_max')) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 7 }) {
        if (value === 'system') {
          Image(this.themePreference === value ? $r('app.media.theme_monitor_active') : $r('app.media.theme_monitor'))
            .width(18)
            .height(18)
            .objectFit(ImageFit.Contain)
        } else {
          SymbolGlyph(symbol)
            .fontSize(18)
            .fontColor([
              this.themePreference === value ? $r('app.color.primary_active') : $r('app.color.body')
            ])
        }
        Text(label)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.themePreference === value ? $r('app.color.primary_active') : $r('app.color.body'))
      }.justifyContent(FlexAlign.Center)
    }
      .layoutWeight(1).height(44).padding(0)
      .backgroundColor(this.themePreference === value ? $r('app.color.primary_tint') : $r('app.color.canvas'))
      .border({
        width: 1,
        color: this.themePreference === value ? $r('app.color.primary') : $r('app.color.hairline')
      })
      .borderRadius(8).clip(true)
      .onClick(() => {
        this.onSetTheme(value);
        this.onClose();
      })
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Row().width('100%').height('100%').backgroundColor(Color.Transparent)
        .onClick(() => this.onClose())
      Column() {
        Row() {
          Text('主题模式').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(16).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.ink')).layoutWeight(1)
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(15).fontColor([$r('app.color.body')])
          }.width(34).height(34).padding(0).backgroundColor($r('app.color.surface_soft'))
            .borderRadius(8).id('desktop_theme_close').accessibilityText('关闭主题模式')
            .onClick(() => this.onClose())
        }.width('100%').height(42)
        Row({ space: 6 }) {
          this.themeChoice('system', '系统')
          this.themeChoice('light', '日间', $r('sys.symbol.sun_max'))
          this.themeChoice('dark', '夜间', $r('sys.symbol.moon'))
        }.width('100%').margin({ top: 10 })
      }
      .width(282).padding(14).margin({ top: 70, right: 12 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
      .shadow({ radius: 18, color: $r('app.color.popover_shadow'), offsetY: 6 })
    }.width('100%').height('100%').zIndex(35).transition(floatingSurfaceTransition())
      .onAppear(() => this.focusPanel())
  }

}

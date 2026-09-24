import { WORKSPACE_TIPS } from './WorkspaceTips';

@Component
export struct BackToTopControl {
  @Prop @Watch('scrollChanged') visible: boolean = false;
  @Prop @Watch('scrollChanged') scrollOffset: number = 0;
  @Prop progress: number = 0;
  onBackToTop: () => void = () => {};
  @State private idle: boolean = false;
  @State private hovered: boolean = false;
  @State private focused: boolean = false;
  private idleTimer: number = -1;

  aboutToAppear(): void {
    this.scrollChanged();
  }

  aboutToDisappear(): void {
    this.clearIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== -1) {
      clearTimeout(this.idleTimer);
      this.idleTimer = -1;
    }
  }

  private scrollChanged(): void {
    this.clearIdleTimer();
    this.idle = false;
    if (this.visible && !this.hovered && !this.focused) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = -1;
        this.idle = true;
      }, 2500);
    }
  }

  private shown(): boolean {
    return this.visible && (!this.idle || this.hovered || this.focused);
  }

  private normalizedProgress(): number {
    return Math.min(1, Math.max(0, this.progress));
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.arrow_up'))
          .fontSize(18)
          .fontColor([$r('app.color.body')])
      }
      .width(45)
      .height(45)
      .padding(0)
      .backgroundColor($r('app.color.surface_soft'))
      .borderRadius(11)
      .clip(true)
      .shadow({ radius: 5, color: $r('app.color.popover_shadow'), offsetY: 1 })
      .accessibilityText(`返回顶部，当前滚动进度 ${Math.round(this.normalizedProgress() * 100)}%`).bindTips('返回顶部', WORKSPACE_TIPS)
      .enabled(this.visible)
      .onHover((hovered: boolean) => {
        this.hovered = hovered;
        this.scrollChanged();
      })
      .onFocus(() => {
        this.focused = true;
        this.scrollChanged();
      })
      .onBlur(() => {
        this.focused = false;
        this.scrollChanged();
      })
      .onClick(this.onBackToTop)
      Rect()
        .width(45)
        .height(45)
        .fill(Color.Transparent)
        .stroke($r('app.color.hairline_soft'))
        .strokeWidth(2)
        .radiusWidth(11)
        .radiusHeight(11)
        .hitTestBehavior(HitTestMode.None)
      Rect()
        .width(45)
        .height(45)
        .fill(Color.Transparent)
        .stroke($r('app.color.primary'))
        .strokeWidth(2)
        .strokeDashArray([161 * this.normalizedProgress(), 161])
        .radiusWidth(11)
        .radiusHeight(11)
        .hitTestBehavior(HitTestMode.None)
    }
    .width(48)
    .height(48)
    .opacity(this.shown() ? 0.9 : 0)
    .animation({ duration: this.shown() ? 0 : 140, curve: Curve.Ease })
    .hitTestBehavior(this.shown() ? HitTestMode.Default : HitTestMode.None)
  }
}

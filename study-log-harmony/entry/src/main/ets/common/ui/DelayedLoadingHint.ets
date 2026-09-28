@Component
struct IndeterminateLoadingLine {
  @State private travel: number = 0;
  private trackWidth: number = 0;

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row().width('30%').height(2).backgroundColor($r('app.color.primary'))
        .translate({ x: this.travel })
    }.width('100%').height(2).clip(true).id('content_loading_line')
      .onAreaChange((_old, area) => {
        const width = Number(area.width);
        if (width <= 0 || width === this.trackWidth) return;
        this.trackWidth = width;
        this.getUIContext().animateTo({ duration: 0 }, () => this.travel = -width * 0.3);
        this.getUIContext().animateTo({ duration: 1200, iterations: -1, curve: Curve.Linear },
          () => this.travel = width);
      })
  }
}

@Component
export struct DelayedLoadingHint {
  @Prop @Watch('loadingChanged') loading: boolean = false;
  @Prop text: string = '正在加载…';
  @State private visible: boolean = false;
  @State private slow: boolean = false;
  private timer: number = -1;
  private slowTimer: number = -1;

  private loadingChanged(): void {
    clearTimeout(this.timer);
    clearTimeout(this.slowTimer);
    this.visible = false;
    this.slow = false;
    if (this.loading) {
      this.timer = setTimeout(() => this.visible = this.loading, 200);
      this.slowTimer = setTimeout(() => this.slow = this.loading, 3000);
    }
  }

  aboutToAppear(): void { this.loadingChanged(); }
  aboutToDisappear(): void { clearTimeout(this.timer); clearTimeout(this.slowTimer); }

  build() {
    Column() {
      if (this.visible) {
        IndeterminateLoadingLine().accessibilityText(this.text)
      }
      if (this.slow) {
        Text('正在加载…').fontSize(12).fontColor($r('app.color.muted'))
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .margin({ top: 8 }).id('content_loading_slow')
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Start)
      .alignItems(HorizontalAlign.Center)
      .hitTestBehavior(HitTestMode.None)
  }
}

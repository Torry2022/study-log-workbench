// Shared equal-width segmented-control selection surface; never intercepts input.
@Component
export struct SegmentIndicator {
  @Prop @Watch('selectionChanged') selected: number = 0;
  @Prop count: number = 2;
  @Prop inset: number = 3;
  @State private selectedPosition: number = 0;
  @State private controlWidth: number = 0;

  aboutToAppear(): void { this.selectedPosition = this.selected; }

  private selectionChanged(): void {
    this.getUIContext().animateTo({ duration: 170, curve: Curve.EaseOut }, () => {
      this.selectedPosition = this.selected;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Row().width(Math.max(0, (this.controlWidth - this.inset * 2) / this.count))
        .height('100%').backgroundColor($r('app.color.canvas')).borderRadius(6)
        .translate({ x: Math.max(0, (this.controlWidth - this.inset * 2) / this.count) * this.selectedPosition })
    }.width('100%').height('100%').padding(this.inset)
      .onAreaChange((_old, area) => this.controlWidth = Number(area.width))
      .hitTestBehavior(HitTestMode.None)
  }
}

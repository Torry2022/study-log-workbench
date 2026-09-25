export class LoadingHintPlacement {
  loading: boolean = false;
  x: number = 0;
  y: number = 0;
  width: number = 0;
  height: number = 0;
}

// Only measures the hint's slot. The visible hint lives outside transition snapshots.
@Component
export struct LoadingHintAnchor {
  @Prop @Watch('publish') loading: boolean = false;
  onChange: (placement: LoadingHintPlacement) => void = () => {};
  private placement: LoadingHintPlacement = new LoadingHintPlacement();

  private publish(): void {
    this.report(this.loading);
  }

  aboutToDisappear(): void {
    this.report(false);
  }

  private report(loading: boolean): void {
    this.onChange({ loading,
      x: this.placement.x, y: this.placement.y,
      width: this.placement.width, height: this.placement.height });
  }

  build() {
    Row().width('100%').height('100%').hitTestBehavior(HitTestMode.None)
      .onAreaChange((_oldArea, area) => {
        this.placement = {
          loading: this.loading,
          x: Number(area.globalPosition.x), y: Number(area.globalPosition.y),
          width: Number(area.width), height: Number(area.height)
        };
        this.publish();
      })
  }
}

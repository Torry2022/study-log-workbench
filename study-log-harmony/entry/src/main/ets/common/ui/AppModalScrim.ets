// Only the backdrop enters phone/tablet system safe areas. Dialog content stays inset.
// Desktop title/menu bars are app chrome, so they remain outside the backdrop.
@Component
export struct AppModalScrim {
  @StorageProp('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  onDismiss: () => void = () => {};

  build() {
    Row().width('100%').height('100%').backgroundColor($r('app.color.scrim'))
      .expandSafeArea([SafeAreaType.SYSTEM], this.desktopWindowChrome ? [] : [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      .onClick(this.onDismiss)
  }
}

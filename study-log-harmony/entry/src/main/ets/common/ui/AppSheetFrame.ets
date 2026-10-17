// Bottom sheets extend behind the navigation indicator; centered sheets do not.
@Component
export struct AppSheetFrame {
  @StorageProp('windowBottomAvoidPx') private windowBottomAvoidPx: number = 0;
  @StorageProp('softwareKeyboardVisible') private keyboardVisible: boolean = false;
  @Prop bottomSheet: boolean = false;
  @Prop fillAvailableHeight: boolean = false;
  @BuilderParam content: () => void;

  build() {
    Column() {
      if (this.fillAvailableHeight) {
        Column() { this.content() }.width('100%').layoutWeight(1)
      } else {
        this.content()
      }
    }.width('100%').height(this.fillAvailableHeight ? '100%' : undefined)
      .padding({ bottom: this.bottomSheet && !this.keyboardVisible ?
        this.getUIContext().px2vp(this.windowBottomAvoidPx) : 0 })
      .backgroundColor($r('app.color.canvas'))
  }
}

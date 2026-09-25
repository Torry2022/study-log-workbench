@Component
export struct ContentLoadingState {
  @Prop text: string = '正在加载…';

  build() {
    Column({ space: 8 }) {
      LoadingProgress().width(24).height(24).color($r('app.color.primary'))
      Text(this.text).fontSize(12).fontColor($r('app.color.muted'))
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center).hitTestBehavior(HitTestMode.None)
  }
}

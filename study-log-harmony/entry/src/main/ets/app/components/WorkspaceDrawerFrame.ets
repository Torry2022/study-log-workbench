import { AppModalScrim } from '../../common/ui/AppModalScrim';

// Paint system insets behind the drawer; keep header and scroll content inside the safe layout.
@Component
export struct WorkspaceDrawerFrame {
  @Prop horizontalOffset: number = 0;
  @Prop scrimOpacity: number = 1;
  onDismiss: () => void = () => {};
  @BuilderParam header: () => void;
  @BuilderParam content: () => void;
  private headerHeight: number = 64;

  build() {
    Stack({ alignContent: Alignment.Start }) {
      AppModalScrim({ onDismiss: this.onDismiss }).opacity(this.scrimOpacity)
      Stack({ alignContent: Alignment.TopStart }) {
        Row().width('100%').height('100%').backgroundColor($r('app.color.canvas'))
          .border({ width: { right: 1 }, color: $r('app.color.hairline') })
          .shadow({ radius: 18, color: '#24141413', offsetX: 4 })
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
          .hitTestBehavior(HitTestMode.None)
        // Fixed-height expansion is allowed to move this paint-only band, never the title content.
        Row().width('100%').height(this.headerHeight).backgroundColor($r('app.color.surface_soft'))
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
          .hitTestBehavior(HitTestMode.None)
        Column() {
          Column() { this.header() }.width('100%').height(this.headerHeight)
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
            .id('navigation_drawer_header')
          Column() { this.content() }.width('100%').layoutWeight(1).id('navigation_drawer_body')
        }.width('100%').height('100%')
      }.width('82%').height('100%').translate({ x: this.horizontalOffset }).id('navigation_drawer_frame')
    }.width('100%').height('100%')
  }
}

import { FrameAction } from '../../common/ui/FrameAction';

@Component
export struct LoginBackdrop {
  @State private textureOffset: number = 0;
  private visible: boolean = false;

  aboutToAppear(): void {
    this.visible = true;
    this.getUIContext().postFrameCallback(new FrameAction(() => {
      if (this.visible) {
        this.getUIContext().animateTo({ duration: 12000, curve: Curve.Linear, iterations: -1 }, () => this.textureOffset = 200);
      }
    }));
  }

  aboutToDisappear(): void { this.visible = false; }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_belt_falling'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: -this.textureOffset - 200, y: -this.textureOffset - 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_belt_rising'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: this.textureOffset - 300, y: -this.textureOffset - 100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('100%')
        .height('100%')
        .backgroundImage($r('app.media.login_knowledge_texture'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('100%')
        .height('100%')
        .backgroundImage($r('app.media.login_knowledge_nodes'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .backgroundImagePosition({ x: -100, y: -100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_markdown_marker'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: -this.textureOffset - 200, y: -this.textureOffset - 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_markdown_marker'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: this.textureOffset - 300, y: -this.textureOffset - 100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.surface_soft'))
    .clip(true).hitTestBehavior(HitTestMode.None).accessibilityLevel('no-hide-descendants')
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
  }
}

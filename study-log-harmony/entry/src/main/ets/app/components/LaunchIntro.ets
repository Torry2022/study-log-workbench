import curves from '@ohos.curves';
import display from '@ohos.display';

let hasPlayedLaunchIntro: boolean = false;
const introDisplay = display.getDefaultDisplaySync();
const introHorizontalTravel: number = introDisplay.width / introDisplay.densityPixels / 2 + 48;
const introVerticalTravel: number = introDisplay.height / introDisplay.densityPixels / 2 + 48;

@Component
export struct LaunchIntro {
  @Prop @Watch('readyChanged') ready: boolean = false;
  onDismissed: () => void = () => {};
  @State private visible: boolean = !hasPlayedLaunchIntro;
  @State private nodesGathered: boolean = false;
  @State private topGathered: boolean = false;
  @State private middleGathered: boolean = false;
  @State private bottomGathered: boolean = false;
  @State private frameVisible: boolean = false;
  @State private sloganVisible: boolean = false;
  @State private loadingVisible: boolean = false;
  @State private introOpacity: number = 1;
  private completedAnimations: number = 0;
  private dismissing: boolean = false;
  private dismissalNotified: boolean = false;

  private readyChanged(): void {
    this.tryDismiss();
  }

  private tryDismiss(force: boolean = false): void {
    if (!this.visible || this.dismissing || this.completedAnimations < 3 || (!this.ready && !force)) return;
    this.dismissing = true;
    this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseOut, onFinish: () => {
      this.visible = false;
      this.notifyDismissed();
    } }, () => {
      this.introOpacity = 0;
    });
  }

  private animationCompleted(): void {
    this.completedAnimations += 1;
    if (this.completedAnimations < 3) return;
    this.loadingVisible = !this.ready;
    this.tryDismiss();
  }

  private notifyDismissed(): void {
    if (this.dismissalNotified) return;
    this.dismissalNotified = true;
    this.onDismissed();
  }

  private startAnimation(): void {
    if (!this.visible) return;
    hasPlayedLaunchIntro = true;

    setTimeout(() => {
      this.getUIContext().animateTo({ curve: curves.springMotion(0.24, 0.68, 0),
        onFinish: () => this.animationCompleted() }, () => {
        this.nodesGathered = true;
        this.topGathered = true;
        this.middleGathered = true;
        this.bottomGathered = true;
      });
    }, 300);
    setTimeout(() => {
      this.getUIContext().animateTo({ curve: curves.springMotion(0.28, 0.62, 0),
        onFinish: () => this.animationCompleted() }, () => {
        this.frameVisible = true;
      });
    }, 410);
    setTimeout(() => {
      this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseOut,
        onFinish: () => this.animationCompleted() }, () => {
        this.sloganVisible = true;
      });
    }, 470);
    setTimeout(() => {
      this.tryDismiss(true);
    }, 8000);
  }

  @Builder
  private introContent() {
    Column() {
      Stack({ alignContent: Alignment.Center }) {
        Row() {}
          .width(84)
          .height(84)
          .borderRadius(17)
          .backgroundColor($r('app.color.surface_soft'))
          .border({ width: 2, color: $r('app.color.hairline') })
          .scale({ x: this.frameVisible ? 1 : 0.76, y: this.frameVisible ? 1 : 0.76 })
          .opacity(this.frameVisible ? 1 : 0)

        Stack({ alignContent: Alignment.TopStart }) {
          Row() {}
            .width(4.6)
            .height(39.4)
            .borderRadius(2.3)
            .backgroundColor($r('app.color.primary'))
            .position({ x: 21.3, y: 22.3 })
          Circle()
            .width(10.5)
            .height(10.5)
            .fill($r('app.color.primary'))
            .position({ x: 18.4, y: 17.1 })
          Circle()
            .width(10.5)
            .height(10.5)
            .fill($r('app.color.primary'))
            .position({ x: 18.4, y: 36.8 })
          Circle()
            .width(10.5)
            .height(10.5)
            .fill($r('app.color.primary'))
            .position({ x: 18.4, y: 56.4 })
        }
        .width(84)
        .height(84)
        .translate({ x: this.nodesGathered ? 0 : -introHorizontalTravel })

        Stack({ alignContent: Alignment.TopStart }) {
          Row() {}
            .width(23.6)
            .height(5.3)
            .borderRadius(2.7)
            .backgroundColor($r('app.color.ink'))
            .position({ x: 36.8, y: 19.7 })
        }
        .width(84)
        .height(84)
        .translate({ y: this.topGathered ? 0 : -introVerticalTravel })

        Image($r('app.media.launch_arrow'))
        .width(84)
        .height(84)
        .objectFit(ImageFit.Contain)
        .translate({ x: this.middleGathered ? 0 : introHorizontalTravel })

        Stack({ alignContent: Alignment.TopStart }) {
          Row() {}
            .width(23.6)
            .height(5.3)
            .borderRadius(2.7)
            .backgroundColor($r('app.color.ink'))
            .position({ x: 36.8, y: 59.1 })
        }
        .width(84)
        .height(84)
        .translate({ y: this.bottomGathered ? 0 : introVerticalTravel })

        Text('记录所学，连接所思')
          .width('100%')
          .fontFamily('StudyLogSlogan')
          .fontSize(17)
          .fontWeight(FontWeight.Regular)
          .fontColor($r('app.color.muted'))
          .textAlign(TextAlign.Center)
          .translate({ y: this.sloganVisible ? 68 : 76 })
          .opacity(this.sloganVisible ? 1 : 0)

        Row({ space: 6 }) {
          LoadingProgress()
            .width(14)
            .height(14)
            .color($r('app.color.primary'))
          Text('正在准备工作区…')
            .fontFamily('HarmonyOS Sans SC')
            .fontSize(12)
            .fontColor($r('app.color.muted_soft'))
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .translate({ y: 105 })
        .opacity(this.loadingVisible ? 1 : 0)
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor($r('app.color.canvas'))
    .opacity(this.introOpacity)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }

  build() {
    if (this.visible) {
      this.introContent()
    }
  }

  aboutToAppear(): void {
    if (!this.visible) {
      setTimeout(() => this.notifyDismissed(), 0);
      return;
    }
    setTimeout(() => this.startAnimation(), 32);
  }
}

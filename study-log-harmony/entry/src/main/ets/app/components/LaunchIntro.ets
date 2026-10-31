import curves from '@ohos.curves';
import display from '@ohos.display';
import { AnimatorResult } from '@kit.ArkUI';
import { LaunchMotion } from './LaunchMotion';

let hasPlayedLaunchIntro: boolean = false;
const introDisplay = display.getDefaultDisplaySync();
const introHorizontalTravel: number = introDisplay.width / introDisplay.densityPixels / 2 + 48;
const introVerticalTravel: number = introDisplay.height / introDisplay.densityPixels / 2 + 48;

@Component
export struct LaunchIntro {
  @Prop @Watch('readyChanged') ready: boolean = false;
  onDismissed: () => void = () => {};
  @State private visible: boolean = !hasPlayedLaunchIntro;
  @State private gatherX: number = introHorizontalTravel;
  @State private gatherY: number = introVerticalTravel;
  @State private logoScale: number = 1;
  private motion: LaunchMotion = new LaunchMotion(introHorizontalTravel, introVerticalTravel);
  private animator: AnimatorResult | undefined = undefined;
  private active: boolean = true;
  private logoCompleted: boolean = false;
  private timers: number[] = [];
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
    if (!this.active) return;
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

    this.animator = this.getUIContext().createAnimator({ duration: 1100, easing: 'linear', delay: 0,
      fill: 'forwards', direction: 'normal', iterations: 1, begin: 0, end: 1100 });
    this.animator.onFrame = (time: number) => {
      if (!this.active) return;
      this.motion.advance(time);
      this.gatherX = this.motion.x;
      this.gatherY = this.motion.y;
      this.logoScale = this.motion.scale;
      if (time >= 700 && !this.logoCompleted) {
        this.logoCompleted = true;
        this.animationCompleted();
      }
    };
    this.animator.play();
    this.timers.push(setTimeout(() => {
      this.getUIContext().animateTo({ curve: curves.springMotion(0.28, 0.62, 0),
        onFinish: () => this.animationCompleted() }, () => {
        this.frameVisible = true;
      });
    }, 410));
    this.timers.push(setTimeout(() => {
      this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseOut,
        onFinish: () => this.animationCompleted() }, () => {
        this.sloganVisible = true;
      });
    }, 470));
    this.timers.push(setTimeout(() => {
      this.tryDismiss(true);
    }, 8000));
  }

  aboutToDisappear(): void {
    this.active = false;
    this.timers.forEach((timer: number) => clearTimeout(timer));
    this.timers = [];
    if (this.animator) {
      this.animator.onFrame = () => {};
      this.animator.finish();
      this.animator = undefined;
    }
  }

  @Builder
  private introContent() {
    Column() {
      Stack({ alignContent: Alignment.Center }) {
        Stack({ alignContent: Alignment.Center }) {
          Row() {}
            .width(84)
            .height(84)
            .borderRadius(17)
            .backgroundColor($r('app.color.logo_surface'))
            .border({ width: 2, color: $r('app.color.hairline') })
            .scale({ x: this.frameVisible ? 1 : 0.76, y: this.frameVisible ? 1 : 0.76 })
            .opacity(this.frameVisible ? 1 : 0)

          Image($r('app.media.launch_nodes'))
          .width(84)
          .height(84)
          .objectFit(ImageFit.Contain)
          .translate({ x: -this.gatherX })

          Image($r('app.media.launch_top'))
          .width(84)
          .height(84)
          .objectFit(ImageFit.Contain)
          .translate({ y: -this.gatherY })

          Image($r('app.media.launch_arrow'))
          .width(84)
          .height(84)
          .objectFit(ImageFit.Contain)
          .translate({ x: this.gatherX })

          Image($r('app.media.launch_bottom'))
          .width(84)
          .height(84)
          .objectFit(ImageFit.Contain)
          .translate({ y: this.gatherY })

        }
        .width(84).height(84)
        .scale({ x: this.logoScale, y: this.logoScale })

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
      this.timers.push(setTimeout(() => this.notifyDismissed(), 0));
      return;
    }
    this.timers.push(setTimeout(() => this.startAnimation(), 32));
  }
}

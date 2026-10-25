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
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private canvasReady: boolean = false;
  private active: boolean = true;
  private logoCompleted: boolean = false;
  private timers: number[] = [];
  private coral: string = '#d07a5f';
  private ink: string = '#171614';
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

    const resources = this.getUIContext().getHostContext()?.resourceManager;
    if (resources) {
      this.coral = '#' + (resources.getColorSync($r('app.color.launch_coral').id) & 0xffffff).toString(16).padStart(6, '0');
      this.ink = '#' + (resources.getColorSync($r('app.color.launch_ink').id) & 0xffffff).toString(16).padStart(6, '0');
    }
    this.animator = this.getUIContext().createAnimator({ duration: 1100, easing: 'linear', delay: 0,
      fill: 'forwards', direction: 'normal', iterations: 1, begin: 0, end: 1100 });
    this.animator.onFrame = (time: number) => {
      if (!this.active) return;
      this.motion.advance(time);
      this.gatherX = this.motion.x;
      this.gatherY = this.motion.y;
      this.logoScale = this.motion.scale;
      this.drawDrops(time);
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

  private drawDrops(time: number): void {
    if (!this.canvasReady) return;
    const context = this.canvas;
    context.clearRect(0, 0, 160, 160);
    for (const source of this.motion.drops) {
      const drop = this.motion.frame(source, time);
      if (drop.opacity <= 0) continue;
      context.save();
      context.translate(80 + drop.x, 80 + drop.y);
      context.rotate(drop.angle);
      context.scale(drop.scaleX, drop.scaleY);
      context.fillStyle = drop.ink ? this.ink : this.coral;
      context.globalAlpha = drop.opacity;
      context.beginPath();
      context.ellipse(0, 0, drop.size / 2, drop.size / 2, 0, 0, Math.PI * 2);
      context.fill();
      const width = 2.4 * 84 / 72 * drop.neckX, height = 7 * 84 / 72 * drop.neckY;
      context.globalAlpha = drop.opacity * drop.neckOpacity;
      context.beginPath();
      context.moveTo(-width / 2, 0);
      context.bezierCurveTo(-width / 2, height, width / 2, height, width / 2, 0);
      context.closePath();
      context.fill();
      context.restore();
    }
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

          Canvas(this.canvas).width(160).height(160)
            .onReady(() => this.canvasReady = true)
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

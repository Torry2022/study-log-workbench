import { ComponentContent, LevelOrder, UIContext } from '@kit.ArkUI';
import { iconTint } from './IconTint';
import { InteractiveSurface, animateHover } from './InteractiveSurface';

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

export interface FeedbackAction {
  label: string;
  onAction: () => void;
}

export function feedbackIsPersistent(tone: FeedbackTone, scope: string = ''): boolean {
  return scope !== 'navigation' && (tone === 'warning' || tone === 'error');
}

class FeedbackOptions {
  message: string;
  tone: FeedbackTone;
  hasBottomNavigation: () => boolean;
  onDismiss: () => void;
  visible: boolean = true;
  scope: string = '';
  action?: FeedbackAction;
  onHover: (hovered: boolean) => void = () => {};
  onHidden: () => void = () => {};

  constructor(message: string, tone: FeedbackTone, hasBottomNavigation: () => boolean, onDismiss: () => void) {
    this.message = message;
    this.tone = tone;
    this.hasBottomNavigation = hasBottomNavigation;
    this.onDismiss = onDismiss;
  }
}

@Component
struct FeedbackView {
  @Prop @Watch('visibilityChanged') options: FeedbackOptions;
  @State private viewportWidth: number = 0;
  @State private revealed: boolean = false;
  @State private actionHovered: boolean = false;

  private visibilityChanged(): void {
    if (this.viewportWidth <= 0) return;
    const options = this.options;
    this.getUIContext().animateTo({
      duration: options.visible ? 200 : 160,
      curve: Curve.EaseOut,
      onFinish: () => { if (!options.visible) options.onHidden(); }
    }, () => this.revealed = options.visible);
  }

  private stripeColor(): Resource {
    if (this.options.tone === 'success') return $r('app.color.accent_teal');
    if (this.options.tone === 'warning') return $r('app.color.warning');
    if (this.options.tone === 'error') return $r('app.color.error');
    return $r('app.color.primary');
  }

  private icon(): Resource {
    if (this.options.tone === 'success') return $r('app.media.circle_check');
    if (this.options.tone === 'warning') return $r('app.media.triangle_alert');
    if (this.options.tone === 'error') return $r('app.media.circle_alert');
    return $r('app.media.info');
  }

  private cardMaxWidth(): number {
    return Math.max(0, this.viewportWidth < 600 ? Math.min(360, this.viewportWidth - 32) : Math.min(520, this.viewportWidth - 36));
  }

  private messageMaxWidth(): number {
    const cardWidth = this.cardMaxWidth();
    // Reserve padding, borders, the status icon, gaps and the optional close button before measuring text.
    return Math.max(0, cardWidth - (this.viewportWidth < 600 ? 28 : 32) - 16 - 9 - (this.options.action ? 53 : 0) - (feedbackIsPersistent(this.options.tone, this.options.scope) ? 35 : 0));
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Row({ space: 9 }) {
        Image(this.icon()).width(16).height(16).flexShrink(0)
          .colorFilter(iconTint($r('app.color.body_strong')))
        Text(this.options.message).id('app_feedback_message')
          .fontFamily('HarmonyOS Sans SC').fontSize(13).lineHeight(19.5)
          .constraintSize({ maxWidth: this.messageMaxWidth() })
          .fontColor($r('app.color.body_strong')).flexShrink(1)
        if (this.options.action) {
          Button({ type: ButtonType.Normal }) {
            Text(this.options.action.label).fontFamily('HarmonyOS Sans SC')
              .fontSize(13).lineHeight(19.5).fontWeight(FontWeight.Medium)
              .fontColor($r('app.color.primary_active')).maxLines(1)
          }
          .id('app_feedback_action').width(44).height(19.5).padding(0).flexShrink(0).borderRadius(4)
          .attributeModifier(new InteractiveSurface(Color.Transparent, this.actionHovered))
          .responseRegion({ x: 0, y: -10.25, width: 44, height: 40 })
          .onHover((hovered: boolean) => animateHover(this.getUIContext(), () => this.actionHovered = hovered))
          .accessibilityText(this.options.action.label).onClick(() => this.options.action?.onAction())
        }
        if (feedbackIsPersistent(this.options.tone, this.options.scope)) {
          Button({ type: ButtonType.Normal }) {
            Image($r('app.media.x')).width(15).height(15)
              .colorFilter(iconTint($r('app.color.body_strong')))
          }
          .id('app_feedback_dismiss').width(26).height(26).padding(0).flexShrink(0)
          .responseRegion({ x: -7, y: -7, width: 40, height: 40 })
          .borderRadius(6).backgroundColor(Color.Transparent)
          .accessibilityText('关闭提示').onClick(this.options.onDismiss)
        }
      }
      .id('app_feedback')
      .constraintSize({ minHeight: 40, maxWidth: this.cardMaxWidth() })
      .justifyContent(FlexAlign.Center)
      .padding({ top: this.viewportWidth < 600 ? 8 : 12, bottom: this.viewportWidth < 600 ? 8 : 12,
        left: this.viewportWidth < 600 ? 12 : 14, right: this.viewportWidth < 600 ? 12 : 14 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: { left: 3, right: 1, top: 1, bottom: 1 },
        color: { left: this.stripeColor(), right: $r('app.color.hairline'),
          top: $r('app.color.hairline'), bottom: $r('app.color.hairline') } })
      .borderRadius(8)
      .shadow({ radius: $r('app.float.toast_shadow_radius'), offsetY: $r('app.float.toast_shadow_offset'),
        color: $r('app.color.toast_shadow') })
      .accessibilityGroup(!this.options.action).accessibilityText(this.options.message)
      .onHover((hovered: boolean) => this.options.onHover(hovered))
      .opacity(this.revealed ? 1 : 0)
      .translate({ y: this.revealed ? 0 : 8 })
    }
    .width('100%').height('100%')
    .padding({ left: this.viewportWidth < 840 ? 14 : 18, right: this.viewportWidth < 840 ? 14 : 18,
      bottom: this.options.hasBottomNavigation() ? 78 : 18 })
    .hitTestBehavior(HitTestMode.Transparent)
    .onAreaChange((_old: Area, area: Area) => {
      const initialLayout = this.viewportWidth <= 0;
      this.viewportWidth = Number(area.width);
      if (initialLayout) this.visibilityChanged();
    })
  }
}

@Builder
function feedbackBuilder(options: FeedbackOptions) {
  FeedbackView({ options: options })
    // The custom-component wrapper must also let touches outside the card pass through.
    .hitTestBehavior(HitTestMode.Transparent)
}

class AppFeedback {
  private context?: UIContext;
  private content?: ComponentContent<FeedbackOptions>;
  private timer: number = -1;
  private options?: FeedbackOptions;
  private revision: number = 0;
  private remaining: number = 0;
  private deadline: number = 0;
  private hasBottomNavigation: () => boolean = () => false;

  attach(context: UIContext, hasBottomNavigation: () => boolean): void {
    this.context = context;
    this.hasBottomNavigation = hasBottomNavigation;
  }

  show(message: string, tone: FeedbackTone = 'info', duration: number = 3600, scope: string = '', action?: FeedbackAction): void {
    const context = this.context;
    if (!context) return;
    context.runScopedTask(() => {
      this.clearTimer();
      if (!message) {
        this.dismiss();
        return;
      }
      const options = new FeedbackOptions(message, tone, this.hasBottomNavigation, () => this.dismiss());
      options.scope = scope;
      options.action = action ? { label: action.label, onAction: () => {
        this.dismiss();
        action.onAction();
      } } : undefined;
      options.onHover = (hovered: boolean) => {
        if (this.options !== options || !action || feedbackIsPersistent(tone, scope)) return;
        if (hovered) {
          this.remaining = Math.max(0, this.deadline - Date.now());
          this.clearTimer();
        } else this.startTimer();
      };
      const revision = ++this.revision;
      options.onHidden = () => {
        if (this.revision === revision && this.options?.visible === false) this.removeContent();
      };
      this.options = options;
      if (this.content) {
        this.content.update(options);
      } else {
        this.content = new ComponentContent(context, wrapBuilder(feedbackBuilder), options);
        // Feedback stays above sheets without creating a modal dialog or stealing focus.
        context.getOverlayManager().addComponentContentWithOrder(this.content, LevelOrder.clamp(100000));
      }
      this.remaining = duration;
      if (!feedbackIsPersistent(tone, scope)) this.startTimer();
    });
  }

  dismissScope(scope: string): void {
    if (this.options?.scope === scope) this.dismiss();
  }

  private startTimer(): void {
    this.clearTimer();
    this.deadline = Date.now() + this.remaining;
    this.timer = setTimeout(() => this.dismiss(), this.remaining);
  }

  dismiss(): void {
    this.clearTimer();
    if (!this.content || !this.context || !this.options || !this.options.visible) return;
    const options = new FeedbackOptions(this.options.message, this.options.tone,
      this.hasBottomNavigation, () => this.dismiss());
    options.visible = false;
    options.action = this.options.action;
    options.scope = this.options.scope;
    options.onHidden = this.options.onHidden;
    this.options = options;
    this.context.runScopedTask(() => this.content?.update(options));
  }

  private removeContent(): void {
    if (this.content && this.context) {
      this.context.getOverlayManager().removeComponentContent(this.content);
      this.content.dispose();
      this.content = undefined;
    }
    this.options = undefined;
  }

  detach(): void {
    this.clearTimer();
    this.revision++;
    this.removeContent();
    this.context = undefined;
    this.hasBottomNavigation = () => false;
  }

  private clearTimer(): void {
    if (this.timer !== -1) clearTimeout(this.timer);
    this.timer = -1;
  }
}

export const appFeedback: AppFeedback = new AppFeedback();

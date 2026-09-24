import { InteractiveSurface, animateHover } from './InteractiveSurface';
import { iconTint } from './IconTint';
import { toolbarActionWidth } from './ToolbarLayout';
import { WORKSPACE_TIPS } from './WorkspaceTips';

@Component
export struct ToolbarAction {
  @State private hovered: boolean = false;
  @Prop label: string = '';
  @Prop reservedLabel: string = '';
  @Prop tooltip: string = '';
  @Prop disabledReason: string = '';
  @Prop showLabel: boolean = true;
  @Prop showIcon: boolean = true;
  @Prop icon: Resource = $r('app.media.more_horizontal');
  @Prop symbol: Resource = $r('sys.symbol.plus');
  @Prop iconWidth: number = 40;
  @Prop iconSize: number = 18;
  @Prop controlHeight: number = 40;
  @Prop useSymbol: boolean = false;
  @Prop active: boolean = false;
  @Prop primary: boolean = false;
  @Prop danger: boolean = false;
  @Prop available: boolean = true;
  @Prop busy: boolean = false;
  @Prop segmented: boolean = false;
  onAction: () => void = () => {};

  private contentColor(): Resource {
    if (this.primary) return $r('app.color.on_primary');
    if (this.danger) return $r('app.color.error');
    if (this.segmented) return this.active ? $r('app.color.ink') : $r('app.color.muted');
    return $r('app.color.body');
  }

  build() {
    Stack() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        if (this.busy) {
          LoadingProgress().width(18).height(18)
            .color(this.primary ? $r('app.color.on_primary') : $r('app.color.body'))
        } else if (this.showIcon && this.useSymbol) {
          SymbolGlyph(this.symbol).fontSize(18)
            .fontColor([this.contentColor()])
        } else if (this.showIcon) {
          Image(this.icon).width(this.iconSize).height(this.iconSize).objectFit(ImageFit.Contain)
            .colorFilter(iconTint(this.contentColor()))
        }
        if (this.showLabel) {
          Text(this.label).fontFamily('HarmonyOS Sans SC').fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor(this.contentColor())
            .maxLines(1)
        }
      }.justifyContent(FlexAlign.Center)
    }
    .width(this.showLabel ? toolbarActionWidth(this.reservedLabel || this.label) - (this.showIcon ? 0 : 24) : this.iconWidth)
    .height(this.segmented ? this.controlHeight - 4 : this.controlHeight).padding(0)
    .backgroundColor(this.primary ? $r('app.color.primary') : (this.danger ? $r('app.color.error_surface') :
      (this.segmented ? Color.Transparent : $r('app.color.canvas'))))
    .border({ width: this.segmented ? 0 : 1, color: $r('app.color.hairline') })
    .borderRadius(this.segmented ? 6 : 8).clip(true)
    .attributeModifier(this.primary || this.danger ? undefined : new InteractiveSurface(
      this.segmented ? Color.Transparent : $r('app.color.canvas'), this.hovered, this.active))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = hover))
    .enabled(this.available && !this.busy)
    .accessibilityText(this.label)
    .onClick(this.onAction)
    }
    .bindTips(!this.available && this.disabledReason ? this.disabledReason :
      (this.tooltip && this.tooltip !== this.label ? this.tooltip :
        (this.showLabel ? undefined : this.label)), WORKSPACE_TIPS)
  }
}

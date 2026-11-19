import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';

@Component
export struct ConnectionAction {
  @Prop label: string = '';
  @Prop primary: boolean = false;
  @Prop busy: boolean = false;
  @Prop available: boolean = true;
  @Prop fullWidth: boolean = false;
  @State private hovered: boolean = false;
  onAction: () => void = () => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        if (this.busy) LoadingProgress().width(16).height(16)
          .color(this.primary ? $r('app.color.on_primary') : $r('app.color.body'))
        Text(this.label).fontSize(14).fontWeight(FontWeight.Medium).maxLines(1)
          .fontColor(this.primary ? $r('app.color.on_primary') : $r('app.color.body'))
      }.justifyContent(FlexAlign.Center)
    }.width(this.fullWidth ? '100%' : undefined).height(44).constraintSize({ minWidth: 104 })
      .padding({ left: 20, right: 20 })
      .backgroundColor(this.primary ? $r('app.color.primary') : $r('app.color.canvas'))
      .border({ width: this.primary ? 0 : 1, color: $r('app.color.hairline') })
      .attributeModifier(this.primary ? undefined : new InteractiveSurface($r('app.color.canvas'), this.hovered))
      .borderRadius(8).clip(true)
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = hover))
      .enabled(this.available && !this.busy).accessibilityText(this.label).onClick(this.onAction)
  }
}

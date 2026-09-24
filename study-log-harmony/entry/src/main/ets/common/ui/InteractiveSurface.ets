import { UIContext } from '@kit.ArkUI';

export function animateHover(context: UIContext, update: () => void): void {
  context.animateTo({ duration: 100, curve: Curve.EaseOut }, update);
}

// One background-only state treatment for pointer targets; layout and focus stay with the owner.
export class InteractiveSurface implements AttributeModifier<CommonAttribute> {
  private resting: ResourceColor;
  private hovered: boolean;
  private selected: boolean;

  constructor(resting: ResourceColor, hovered: boolean, selected: boolean = false) {
    // Interpolate alpha against the same RGB; transparent black causes a dark dip mid-hover.
    this.resting = resting === Color.Transparent ? $r('app.color.interaction_hover_clear') : resting;
    this.hovered = hovered;
    this.selected = selected;
  }

  applyNormalAttribute(instance: CommonAttribute): void {
    instance.hoverEffect(HoverEffect.None)
      .backgroundColor(this.hovered && !this.selected ? $r('app.color.interaction_hover') : this.resting);
  }

  applyPressedAttribute(instance: CommonAttribute): void {
    instance.backgroundColor($r('app.color.surface_cream_strong'));
  }

  applyDisabledAttribute(instance: CommonAttribute): void {
    instance.backgroundColor(this.resting);
  }
}

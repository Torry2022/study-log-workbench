// Main filters use regular labels; selection is expressed by the row surface.
export class NavigationRowStyle implements AttributeModifier<CommonAttribute> {
  private wide: boolean;
  constructor(wide: boolean = true) { this.wide = wide; }

  applyNormalAttribute(instance: CommonAttribute): void {
    instance.height(this.wide ? 38 : 44).padding({ left: 10, right: 10 }).borderRadius(8);
  }
}

export class NavigationLabelStyle implements AttributeModifier<TextAttribute> {
  private selected: boolean;
  constructor(selected: boolean) {
    this.selected = selected;
  }

  applyNormalAttribute(instance: TextAttribute): void {
    instance.fontSize(14).fontWeight(FontWeight.Regular)
      .fontColor(this.selected ? $r('app.color.ink') : $r('app.color.body'));
  }
}

export class NavigationSectionStyle implements AttributeModifier<TextAttribute> {
  applyNormalAttribute(instance: TextAttribute): void {
    instance.fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'));
  }
}

export class NavigationCountStyle implements AttributeModifier<TextAttribute> {
  applyNormalAttribute(instance: TextAttribute): void {
    instance.fontSize(12).fontWeight(FontWeight.Regular).constraintSize({ minWidth: 32 }).textAlign(TextAlign.End).flexShrink(0)
      .fontColor($r('app.color.muted_soft'));
  }
}

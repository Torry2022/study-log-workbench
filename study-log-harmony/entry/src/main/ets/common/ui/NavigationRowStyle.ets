// Shared geometry and typography for wide single-line navigation filters.
export class NavigationRowStyle implements AttributeModifier<CommonAttribute> {
  private wide: boolean;
  constructor(wide: boolean = true) { this.wide = wide; }

  applyNormalAttribute(instance: CommonAttribute): void {
    if (this.wide) instance.height(38).padding({ left: 10, right: 10 }).borderRadius(8);
  }
}

export class NavigationLabelStyle implements AttributeModifier<TextAttribute> {
  private selected: boolean;
  private wide: boolean;
  constructor(selected: boolean, wide: boolean = true) {
    this.selected = selected;
    this.wide = wide;
  }

  applyNormalAttribute(instance: TextAttribute): void {
    if (this.wide) instance.fontSize(14).fontWeight(this.selected ? 600 : FontWeight.Regular)
      .fontColor(this.selected ? $r('app.color.ink') : $r('app.color.body'));
  }
}

export class NavigationCountStyle implements AttributeModifier<TextAttribute> {
  private wide: boolean;
  constructor(wide: boolean = true) { this.wide = wide; }

  applyNormalAttribute(instance: TextAttribute): void {
    if (this.wide) instance.fontSize(12).width(32).textAlign(TextAlign.End)
      .fontColor($r('app.color.muted_soft'));
  }
}

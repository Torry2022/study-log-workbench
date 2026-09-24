@Component
export struct AppLogo {
  @Prop iconSize: number = 38;
  @Prop cornerRadius: number = 8;

  build() {
    Image($r('app.media.app_icon_foreground'))
      .width(this.iconSize).height(this.iconSize)
      .backgroundColor($r('app.color.logo_surface'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(this.cornerRadius).clip(true)
  }
}

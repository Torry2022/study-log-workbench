import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';

@Component
export struct ConnectionOptions {
  @Link localHttp: boolean;
  @Prop available: boolean = true;
  @Prop rowId: string = '';
  @State private hovered: boolean = false;

  build() {
    Column({ space: 4 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 10 }) {
          Stack() {
            if (this.localHttp) SymbolGlyph($r('sys.symbol.checkmark')).fontSize(12)
              .fontColor([$r('app.color.on_primary')])
          }.width(18).height(18).borderRadius(4)
            .border({ width: 1, color: this.localHttp ? $r('app.color.primary') : $r('app.color.muted') })
            .backgroundColor(this.localHttp ? $r('app.color.primary') : Color.Transparent).flexShrink(0)
          Text('连接局域网 HTTP 服务').fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Start)
        }.width('100%')
      }.id(this.rowId + '_http').width('100%').constraintSize({ minHeight: 44 })
        .padding({ left: 8, right: 8, top: 6, bottom: 6 }).borderRadius(8)
        .attributeModifier(new InteractiveSurface(Color.Transparent, this.hovered))
        .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = hover))
        .accessibilityText('连接局域网 HTTP 服务').accessibilitySelected(this.localHttp)
        .enabled(this.available).onClick(() => this.localHttp = !this.localHttp)
      Text('开启后密码明文传输，仅用于可信局域网')
        .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).width('100%')
        .padding({ left: 36, right: 8, bottom: 4 })
    }.width('100%')
  }
}

@Entry
@Component
struct Index {
  build() {
    Column({ space: 16 }) {
      Image($r('app.media.app_icon'))
        .width(72)
        .height(72)
      Text('学习日志工作台')
        .fontSize(28)
        .fontColor($r('app.color.ink'))
      Text('鸿蒙公开版正在逐批迁移')
        .fontSize(14)
        .fontColor($r('app.color.muted'))
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor($r('app.color.canvas'))
  }
}

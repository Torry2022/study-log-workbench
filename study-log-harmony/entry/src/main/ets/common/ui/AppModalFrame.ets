// Content covers are window-wide; custom desktop chrome is not a system safe area.
@Component
export struct AppModalFrame {
  @StorageProp('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  @BuilderParam content: () => void;

  build() {
    Column() {
      Column() { this.content() }.width('100%').layoutWeight(1).clip(this.desktopWindowChrome)
        .id('app_modal_content')
    }.width('100%').height('100%')
      // Matches DesktopTitleBar and EntryAbility.setWindowDecorHeight.
      .padding({ top: this.desktopWindowChrome ? 40 : 0 })
  }
}

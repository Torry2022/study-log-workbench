import { ConnectionController } from '../ConnectionController';
import { activeInstance } from '../../common/network/InstanceConfig';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { FormKeyboardContext } from '../../common/ui/FormKeyboardContext';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSerifFamily } from '../../common/ui/Typography';
import { KeyCode } from '@kit.InputKit';

@Component
export struct ConnectionPanel {
  @ObjectLink controller: ConnectionController;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  onClose: () => void = () => {};
  @State private origin: string = activeInstance.origin;
  @State private password: string = '';
  @State private localHttp: boolean = false;
  private scroller: Scroller = new Scroller();
  private keyboard: FormKeyboardContext = new FormKeyboardContext(this.scroller, 'connection_scroll');

  aboutToDisappear(): void { this.controller.dispose(); this.password = ''; this.keyboard.clear(); }

  build() {
    Stack() {
      AppModalScrim({ onDismiss: this.onClose })
      Column() {
        Row({ space: 12 }) {
          Text('更换工作台连接').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(28)
            .fontColor($r('app.color.ink')).layoutWeight(1)
          ToolbarAction({ label: '取消更换连接', showLabel: false, useSymbol: true,
            symbol: $r('sys.symbol.xmark'), available: !this.controller.committing,
            onAction: this.onClose }).id('connection_close')
        }.width('100%').padding(16).flexShrink(0)
        Scroll(this.scroller) {
          Column({ space: 16 }) {
            Text('检查成功并确认后才会切换；失败或取消不会断开当前工作台。')
              .fontSize(14).fontColor($r('app.color.muted')).width('100%')
            Column({ space: 8 }) {
              Text('工作台地址').fontSize(13).fontColor($r('app.color.muted')).width('100%')
              TextInput({ text: this.origin, placeholder: 'https://example.com' }).id('connection_origin')
                .height(48).fontSize(16).backgroundColor($r('app.color.canvas'))
                .fontColor($r('app.color.ink')).borderRadius(8)
                .border({ width: 1, color: $r('app.color.hairline') }).enabled(!this.controller.busy)
                .onFocus(() => this.keyboard.focus(this.getUIContext(), 'connection_origin', 'connection_fields'))
                .onBlur(() => this.keyboard.blur('connection_origin'))
                .onChange((value: string) => { this.origin = value; this.controller.error = ''; })
              Text('访问密码').fontSize(13).fontColor($r('app.color.muted')).width('100%')
              TextInput({ text: this.password, placeholder: '输入工作台访问密码' }).id('connection_password')
                .type(InputType.Password).monopolizeEvents(true).height(48).fontSize(16)
                .backgroundColor($r('app.color.canvas')).fontColor($r('app.color.ink')).borderRadius(8)
                .border({ width: 1, color: $r('app.color.hairline') }).enabled(!this.controller.busy)
                .onFocus(() => this.keyboard.focus(this.getUIContext(), 'connection_password', 'connection_fields'))
                .onBlur(() => this.keyboard.blur('connection_password'))
                .onChange((value: string) => { this.password = value; this.controller.error = ''; })
              Row({ space: 8 }) {
                Checkbox().select(this.localHttp).selectedColor($r('app.color.primary'))
                  .enabled(!this.controller.busy).onChange((value: boolean) => this.localHttp = value)
                Text('允许本地／局域网 HTTP 测试（密码未经加密传输）').fontSize(12)
                  .fontColor($r('app.color.muted')).layoutWeight(1)
              }.width('100%')
              if (this.controller.error) {
                Text(this.controller.error).id('connection_error').width('100%').fontSize(13)
                  .fontColor($r('app.color.error'))
              }
              Row({ space: 12 }) {
                ToolbarAction({ label: '取消', showIcon: false, available: !this.controller.committing, onAction: this.onClose })
                Blank().layoutWeight(1)
                ToolbarAction({ label: '检查并切换', reservedLabel: '检查并切换', showIcon: false,
                  primary: true, busy: this.controller.busy, available: !!this.origin && !!this.password,
                  onAction: () => this.controller.connect({ origin: this.origin, password: this.password, localHttp: this.localHttp }) })
                  .id('connection_submit')
              }.width('100%').margin({ top: 8 })
            }.id('connection_fields').width('100%').onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
          }.width('100%').padding(16)
        }.id('connection_scroll').width('100%').layoutWeight(1).scrollBar(BarState.Auto)
          .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
      }.width('92%').constraintSize({ maxWidth: 600, maxHeight: '88%' })
        .height('88%').backgroundColor($r('app.color.canvas')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
    }.width('100%').height('100%').onKeyEvent((event: KeyEvent) => {
      if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
        event.stopPropagation(); this.onClose();
      }
    })
  }
}

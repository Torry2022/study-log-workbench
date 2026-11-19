import { ConnectionAction } from './ConnectionAction';
import { ConnectionController } from '../ConnectionController';
import { activeInstance } from '../../common/network/InstanceConfig';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { FormKeyboardContext } from '../../common/ui/FormKeyboardContext';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { ConnectionOptions } from './ConnectionOptions';
import { KeyCode } from '@kit.InputKit';

@Component
export struct ConnectionPanel {
  @ObjectLink controller: ConnectionController;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  onClose: () => void = () => {};
  @State private availableHeight: number = 640;
  @State private headerHeight: number = 72;
  private scroller: Scroller = new Scroller();
  private keyboard: FormKeyboardContext = new FormKeyboardContext(this.scroller, 'connection_scroll');

  aboutToDisappear(): void { this.keyboard.clear(); }

  build() {
    Stack() {
      AppModalScrim({ onDismiss: this.onClose })
      Column() {
        Row({ space: 12 }) {
          Text('更换连接').fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(18).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.ink')).layoutWeight(1)
          ToolbarAction({ label: '取消更换连接', showLabel: false, useSymbol: true, segmented: true,
            controlHeight: 44, iconWidth: 44,
            symbol: $r('sys.symbol.xmark'), available: !this.controller.committing,
            onAction: this.onClose }).id('connection_close')
        }.width('100%').padding({ left: 16, right: 16, top: 6, bottom: 6 }).flexShrink(0)
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
          .onAreaChange((_old: Area, area: Area) => this.headerHeight = Number(area.height))
        Scroll(this.scroller) {
          Column({ space: 16 }) {
            ConnectionFields({ controller: this.controller, keyboard: this.keyboard, onClose: this.onClose })
          }.width('100%').padding(16)
        }.id('connection_scroll').width('100%').height(LayoutPolicy.wrapContent)
          .constraintSize({ maxHeight: Math.max(0, Math.min(560, this.availableHeight * 0.84) - this.headerHeight) }).scrollBar(BarState.Auto)
          .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
      }.width('96%').height(LayoutPolicy.wrapContent).constraintSize({ maxWidth: 600, maxHeight: '84%' })
        .backgroundColor($r('app.color.canvas')).borderRadius(12)
        .border({ width: 1, color: $r('app.color.hairline') })
        .shadow({ radius: 22, color: $r('app.color.popover_shadow'), offsetY: 8 }).onClick(() => {})
    }.width('100%').height('100%')
      .onAreaChange((_old: Area, area: Area) => this.availableHeight = Number(area.height))
      .onKeyEvent((event: KeyEvent) => {
      if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
        event.stopPropagation(); this.onClose();
      }
    })
  }
}

@Component
export struct ConnectionFields {
  @ObjectLink controller: ConnectionController;
  @Prop compact: boolean = false;
  scroller: Scroller = new Scroller();
  keyboard: FormKeyboardContext = new FormKeyboardContext(new Scroller(), 'connection_scroll');
  onClose: () => void = () => {};
  @State private origin: string = activeInstance.origin;
  @State private password: string = '';
  @State private localHttp: boolean = false;

  aboutToDisappear(): void { this.password = ''; this.keyboard.clear(); }

  @Builder
  private form() {
    Column({ space: 16 }) {
      Text('核对新工作台后，再确认切换。')
        .fontSize(14).fontColor($r('app.color.muted')).width('100%')
      Column({ space: 12 }) {
        Text('工作台地址').fontSize(13).fontColor($r('app.color.muted')).width('100%')
        TextInput({ text: this.origin, placeholder: 'https://example.com' }).id('connection_origin')
          .height(44).fontSize(16).backgroundColor($r('app.color.canvas'))
          .fontColor($r('app.color.ink')).borderRadius(8)
          .border({ width: 1, color: $r('app.color.hairline') }).enabled(!this.controller.busy)
          .onFocus(() => this.keyboard.focus(this.getUIContext(), 'connection_origin', 'connection_fields'))
          .onBlur(() => this.keyboard.blur('connection_origin'))
          .onChange((value: string) => { this.origin = value; this.controller.error = ''; })
        Text('填写已部署工作台的完整访问地址。').fontSize(12)
          .fontColor($r('app.color.muted')).width('100%')
        Text('访问密码').fontSize(13).fontColor($r('app.color.muted')).width('100%')
        TextInput({ text: this.password, placeholder: '输入工作台访问密码' }).id('connection_password')
          .type(InputType.Password).monopolizeEvents(true).height(44).fontSize(16)
          .backgroundColor($r('app.color.canvas')).fontColor($r('app.color.ink')).borderRadius(8)
          .border({ width: 1, color: $r('app.color.hairline') }).enabled(!this.controller.busy)
          .onFocus(() => this.keyboard.focus(this.getUIContext(), 'connection_password', 'connection_fields'))
          .onBlur(() => this.keyboard.blur('connection_password'))
          .onChange((value: string) => { this.password = value; this.controller.error = ''; })
        Text('由工作台部署者设置。').fontSize(12)
          .fontColor($r('app.color.muted')).width('100%')
        ConnectionOptions({ localHttp: $localHttp, available: !this.controller.busy, rowId: 'connection_options' })
        if (this.controller.error) {
          Text(this.controller.error).id('connection_error').width('100%').fontSize(13)
            .fontColor($r('app.color.error'))
        }
      }.width('100%').padding(16).backgroundColor($r('app.color.surface_soft'))
        .borderRadius(12).border({ width: 1, color: $r('app.color.hairline') })
    }.id('connection_fields').width('100%').alignItems(HorizontalAlign.Start)
      .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
  }
  @Builder
  private actions() {
    Row({ space: 12 }) {
      if (!this.compact) ConnectionAction({ label: '取消', available: !this.controller.committing, onAction: this.onClose })
      Blank().layoutWeight(1)
      ConnectionAction({ label: '检查并切换',
        primary: true, busy: this.controller.busy, available: !!this.origin && !!this.password,
        onAction: () => this.controller.connect({ origin: this.origin, password: this.password, localHttp: this.localHttp }) })
        .id('connection_submit')
    }.width('100%')

  }

  build() {
    Column() {
      if (this.compact) {
        Scroll(this.scroller) {
          this.form()
        }.id('settings_connection_scroll').width('100%').layoutWeight(1).align(Alignment.Top)
          .scrollBar(BarState.Auto).padding({ left: 16, right: 16, top: 20, bottom: 16 })
          .onAreaChange(() => this.keyboard.reveal(this.getUIContext()))
        Column() {
          this.actions()
        }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })
          .border({ width: { top: 1 }, color: $r('app.color.hairline') })
      } else {
        Column({ space: 16 }) {
          this.form()
          this.actions()
        }.width('100%')
      }
    }.width('100%')
  }

}

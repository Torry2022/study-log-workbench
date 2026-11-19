import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { ConnectionAction } from './ConnectionAction';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { LengthMetrics } from '@kit.ArkUI';
import { SettingsConfirmation } from '../SettingsConfirmation';

// Settings-only confirmations keep native modal focus/back handling and app controls.
@CustomDialog
export struct SettingsConfirmDialog {
  controller?: CustomDialogController;
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @ObjectLink confirmation: SettingsConfirmation;

  build() {
    Column() {
      Row({ space: 12 }) {
        Text(this.confirmation.title).fontFamily(workspaceSansFamily(this.breakpoint)).fontSize(18).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink')).layoutWeight(1)
        ToolbarAction({ label: '取消操作', showLabel: false, segmented: true, useSymbol: true,
          symbol: $r('sys.symbol.xmark'), controlHeight: 44, iconWidth: 44, onAction: () => this.confirmation.settle(false) })
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
      Scroll() {
        Column({ space: 24 }) {
          Text(this.confirmation.message).fontSize(14).lineHeight(22).fontColor($r('app.color.body')).width('100%')
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.End,
            space: { main: LengthMetrics.vp(12), cross: LengthMetrics.vp(8) } }) {
            ConnectionAction({ label: this.confirmation.cancelLabel,
              onAction: () => this.confirmation.settle(false) }).id('settings_confirm_cancel')
            ConnectionAction({ label: this.confirmation.acceptLabel, primary: true,
              onAction: () => this.confirmation.settle(true) }).id('settings_confirm_accept')
          }.width('100%')
        }.width('100%').padding(16)
      }.width('100%').height(LayoutPolicy.wrapContent).constraintSize({ maxHeight: 320 }).scrollBar(BarState.Auto)
    }.width('92%').height(LayoutPolicy.wrapContent).constraintSize({ maxWidth: 440, maxHeight: '84%' })
      .backgroundColor($r('app.color.canvas')).borderRadius(12)
      .border({ width: 1, color: $r('app.color.hairline') })
  }
}

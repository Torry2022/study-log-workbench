import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { workspaceDateFamily } from '../../../common/ui/Typography';
import { toolbarActionsWidth } from '../../../common/ui/ToolbarLayout';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';

@Component
export struct ReadingLogHeader {
  @Prop selectedDate: string = '';
  @Prop workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.LARGE;
  @Prop hasOutline: boolean = false;
  @State private showLabels: boolean = false;
  @BuilderParam previousButton: () => void = this.emptyContent;
  @BuilderParam nextButton: () => void = this.emptyContent;
  onOutline: () => void = () => {};
  onExit: () => void = () => {};

  @Builder
  private emptyContent() {}

  build() {
    Row({ space: 8 }) {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.book_pages')).fontSize(17).fontColor([$r('app.color.primary')])
        Text(this.selectedDate).fontFamily(workspaceDateFamily(this.workspaceBreakpoint)).fontSize(24).fontWeight(600)
          .fontFeature('"tnum" 1').fontColor($r('app.color.ink'))
      }.layoutWeight(1)
      this.previousButton()
      this.nextButton()
      ToolbarAction({
        label: '大纲', showLabel: this.showLabels, icon: $r('app.media.layout_list'), iconSize: 17,
        available: this.hasOutline, onAction: () => this.onOutline()
      })
      ToolbarAction({
        label: '退出阅读模式', showLabel: this.showLabels, icon: $r('app.media.minimize_2'), iconSize: 17,
        onAction: () => this.onExit()
      }).id('log_reading_exit')
    }
    .width('100%').height(64).padding({ left: 20, right: 16 })
    .onAreaChange((_oldArea, area) => {
      const required = 196 + toolbarActionsWidth(['上一篇', '下一篇', '大纲', '退出阅读模式']);
      this.showLabels = Number(area.width) >= required + (this.showLabels ? 0 : 12);
    })
    .alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }
}

import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { workspaceDateFamily, workspacePaperMonoFamily } from '../../../common/ui/Typography';

@Component
export struct DesktopLogHeader {
  @Prop fileName: string = '';
  @Prop selectedDate: string = '';
  @Prop workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.LARGE;
  @Prop toolbarWidth: number = 0;
  @Prop dateWidth: number = 0;
  @BuilderParam previousButton: () => void = this.emptyContent;
  @BuilderParam nextButton: () => void = this.emptyContent;
  @BuilderParam actions: () => void = this.emptyContent;
  onDateWidth: (width: number) => void = () => {};
  onWidth: (width: number) => void = () => {};

  @Builder
  private emptyContent() {}

  build() {
    Row({ space: this.toolbarWidth < 440 ? 4 : 8 }) {
      Row({ space: this.toolbarWidth < 440 ? 4 : 8 }) {
        Column({ space: 2 }) {
          Text(this.fileName)
            .fontFamily(workspacePaperMonoFamily(this.workspaceBreakpoint)).fontSize(10)
            .width(this.dateWidth)
            .fontColor($r('app.color.muted')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.selectedDate).fontFamily(workspaceDateFamily(this.workspaceBreakpoint))
            .fontSize(this.toolbarWidth < 440 ? 20 : 24)
            .id('log_document_date')
            .fontWeight(600).fontFeature('"tnum" 1').fontColor($r('app.color.ink'))
            .onAreaChange((_oldArea, area) => this.onDateWidth(Number(area.width)))
        }.alignItems(HorizontalAlign.Start)
          .margin({ right: 8 })
          Row({ space: 8 }) {
            this.previousButton()
            this.nextButton()
          }
      }.alignItems(VerticalAlign.Center).margin({ right: 8 })
      Blank().layoutWeight(1)
      this.actions()
    }
    .width('100%').height(64)
    .padding({ left: this.toolbarWidth < 440 ? 8 : 16, right: this.toolbarWidth < 440 ? 8 : 16 })
    .onAreaChange((_oldArea, area) => this.onWidth(Number(area.width)))
    .alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }
}

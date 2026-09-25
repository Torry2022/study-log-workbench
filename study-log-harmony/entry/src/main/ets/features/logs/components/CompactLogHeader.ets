import { LengthMetrics } from '@kit.ArkUI';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { workspaceDateFamily } from '../../../common/ui/Typography';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';
import { SegmentIndicator } from '../../../common/ui/SegmentIndicator';

@Component
export struct CompactLogHeader {
  @Prop selectedDate: string = '';
  @Prop workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.COMPACT;
  @Prop desktopWindowChrome: boolean = false;
  @Prop sourceMode: boolean = false;
  @Prop saving: boolean = false;
  @Prop dirty: boolean = false;
  @Link moreOpen: boolean;
  @BuilderParam moreActionsPanel: () => void = this.emptyContent;
  onMode: (mode: string) => void = () => {};
  onSave: () => void = () => {};
  onActionsDisappear: () => void = () => {};

  @Builder
  private emptyContent() {}

  build() {
    Row({ space: 6 }) {
          Text(this.selectedDate)
            .id('log_document_date')
            .fontFamily(workspaceDateFamily(this.workspaceBreakpoint))
            .fontSize(24)
            .fontWeight(600)
        .fontFeature('"tnum" 1')
        .fontColor($r('app.color.ink'))
        .layoutWeight(1)

      Stack() {
        SegmentIndicator({ selected: this.sourceMode ? 1 : 0 })
      Row({ space: 0 }) {
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.eye'))
            .width(16)
            .height(16)
            .objectFit(ImageFit.Contain)
            .opacity(!this.sourceMode ? 1 : 0.48)
        }
        .width(34)
        .height(34)
        .padding(0)
        .backgroundColor(Color.Transparent)
        .fontColor(!this.sourceMode ? $r('app.color.ink') : $r('app.color.muted'))
        .borderRadius(6)
        .clip(true)
        .accessibilityText('浏览').bindTips('浏览', WORKSPACE_TIPS)
        .id('log_mode_preview')
        .onClick(() => this.onMode('preview'))
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.edit_3'))
            .width(16)
            .height(16)
            .objectFit(ImageFit.Contain)
            .opacity(this.sourceMode ? 1 : 0.48)
        }
        .width(34)
        .height(34)
        .padding(0)
        .backgroundColor(Color.Transparent)
        .fontColor(this.sourceMode ? $r('app.color.ink') : $r('app.color.muted'))
        .borderRadius(6)
        .clip(true)
        .accessibilityText('源码').bindTips('源码', WORKSPACE_TIPS)
        .id('log_mode_source')
        .onClick(() => this.onMode('source'))
      }
      }
      .width(74)
      .height(40)
      .backgroundColor($r('app.color.surface_soft'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(8)
      .clip(true)

      Button({ type: ButtonType.Normal }) {
        if (this.saving) {
          LoadingProgress().width(18).height(18).color(Color.White)
        } else {
          Image($r('app.media.save'))
            .width(17)
            .height(17)
            .objectFit(ImageFit.Contain)
        }
      }
      .width(40)
      .height(40)
      .padding(0)
      .fontColor(Color.White)
      .backgroundColor($r('app.color.primary'))
      .border({ width: 1, color: $r('app.color.primary') })
      .borderRadius(8)
      .clip(true)
      .enabled(!this.saving && this.dirty)
      .accessibilityText(this.saving ? '保存中' : '保存日志').bindTips(this.saving ? '保存中' : '保存日志', WORKSPACE_TIPS)
      .onClick(() => this.onSave())

      Button({ type: ButtonType.Normal }) {
        Image($r('app.media.more_horizontal'))
          .width(19)
          .height(19)
          .objectFit(ImageFit.Contain)
      }
      .width(40).height(40).padding(0)
      .fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(8).clip(true)
      .accessibilityText('更多日志操作').bindTips('更多日志操作', WORKSPACE_TIPS)
      .id('log_compact_more_actions')
      .onClick(() => this.moreOpen = true)
      .bindSheet($$this.moreOpen, this.moreActionsPanel(), {
        preferType: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
        height: SheetSize.FIT_CONTENT,
        dragBar: false,
        showClose: false,
        maskColor: $r('app.color.scrim'),
        radius: LengthMetrics.vp(12),
        onDisappear: () => this.onActionsDisappear()
      })
    }
    .height(52)
    .width('100%')
    .padding({ left: 16, right: 16 })
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }

}

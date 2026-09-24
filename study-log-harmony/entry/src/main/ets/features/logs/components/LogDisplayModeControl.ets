import { iconTint } from '../../../common/ui/IconTint';
import { toolbarActionWidth } from '../../../common/ui/ToolbarLayout';
import { WORKSPACE_TIPS } from '../../../common/ui/WorkspaceTips';
import { SegmentIndicator } from '../../../common/ui/SegmentIndicator';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';

@Component
export struct LogDisplayModeControl {
  @Prop sourceMode: boolean = false;
  @Prop splitMode: boolean = false;
  @Prop expanded: boolean = true;
  @Prop showLabels: boolean = false;
  @State private menuOpen: boolean = false;
  onMode: (mode: string) => void = () => {};

  private selected(mode: string): boolean {
    return (mode === 'source' && this.sourceMode) || (mode === 'split' && this.splitMode) ||
      (mode === 'preview' && !this.sourceMode && !this.splitMode);
  }

  @Builder
  private modeButton(mode: string, label: string, icon: Resource) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        Image(icon).width(15).height(15).objectFit(ImageFit.Contain)
          .colorFilter(iconTint(this.selected(mode) ? $r('app.color.ink') : $r('app.color.muted')))
        if (this.showLabels) {
          Text(label).fontFamily('HarmonyOS Sans SC').fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.selected(mode) ? $r('app.color.ink') : $r('app.color.muted'))
            .maxLines(1)
        }
      }.justifyContent(FlexAlign.Center)
    }
    .width(this.showLabels ? toolbarActionWidth('浏览') : 40)
    .height(34).padding({ left: 10, right: 10 }).borderRadius(6)
    .backgroundColor(Color.Transparent)
    .accessibilityText(label).bindTips(this.showLabels ? undefined : label, WORKSPACE_TIPS)
    .onClick(() => this.onMode(mode)).id(`log_mode_${mode}`)
  }

  @Builder
  private modeMenu() {
    Column() {
      ForEach(['preview', 'source', 'split'], (mode: string) => {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 8 }) {
            Text(mode === 'preview' ? '浏览' : (mode === 'source' ? '源码' : '分屏'))
              .fontSize(13).fontColor($r('app.color.body')).layoutWeight(1)
            if (this.selected(mode)) {
              SymbolGlyph($r('sys.symbol.checkmark')).fontSize(14).fontColor([$r('app.color.primary')])
            }
          }.width('100%')
        }.width('100%').height(42).padding({ left: 12, right: 12 }).borderRadius(6)
          .backgroundColor(this.selected(mode) ? $r('app.color.surface_soft') : Color.Transparent)
          .id(`log_mode_menu_${mode}`)
          .onClick(() => { this.menuOpen = false; this.onMode(mode); })
      })
    }.width('100%').padding(4)
  }

  build() {
    if (!this.expanded && !this.showLabels) {
      ToolbarAction({ label: '切换显示模式', showLabel: false,
        icon: this.sourceMode ? $r('app.media.edit_3') : (this.splitMode ? $r('app.media.tab_file_text') : $r('app.media.eye')),
        active: this.menuOpen, onAction: () => this.menuOpen = !this.menuOpen })
        .id('log_mode_menu')
        .bindPopup(this.menuOpen, {
          builder: this.modeMenu, placement: Placement.BottomRight,
          popupColor: $r('app.color.canvas'), enableArrow: false, autoCancel: true,
          targetSpace: 4, width: 160, radius: 12, backgroundBlurStyle: BlurStyle.NONE,
          onStateChange: (event) => this.menuOpen = event.isVisible
        })
    } else {
      Stack() {
        SegmentIndicator({ selected: this.sourceMode ? 1 : (this.splitMode ? 2 : 0), count: 3 })
        Row() {
          this.modeButton('preview', '浏览', $r('app.media.eye'))
          this.modeButton('source', '源码', $r('app.media.edit_3'))
          this.modeButton('split', '分屏', $r('app.media.tab_file_text'))
        }.height(40).padding(2)
      }.width(3 * (this.showLabels ? toolbarActionWidth('浏览') : 40) + 6)
        .height(40).backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
    }
  }
}

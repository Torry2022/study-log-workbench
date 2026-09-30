import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { WorkspaceModuleState } from '../WorkspaceModuleState';
import { AppTopBar } from './WorkspaceNavigation';
import { LengthMetrics } from '@kit.ArkUI';
import { ActionPanelHeader } from '../../common/ui/WorkspaceChrome';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { iconTint } from '../../common/ui/IconTint';

@Component
export struct CompactWorkspaceTopBar {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @ObjectLink modules: WorkspaceModuleState;
  @Prop selectedModule: number = 0;
  @Prop desktopWindowChrome: boolean = false;
  @Prop themePreference: string = 'system';
  @Link compactSettingsOpen: boolean;
  onOpenNavigation: () => void = () => {};
  onOpenSearch: () => void = () => {};
  onSetTheme: (value: string) => void = () => {};
  onOpenSettings: () => void = () => {};
  onOpenAbout: () => void = () => {};
  onOpenHelp: () => void = () => {};
  onChangeServer: () => void = () => {};

  private showTopBarDivider(): boolean {
    if ((this.selectedModule === 1)) return this.modules.notesScrolled;
    if ((this.selectedModule === 2)) return this.modules.favoritesScrolled;
    if ((this.selectedModule === 3)) return this.modules.qaScrolled;
    if ((this.selectedModule === 4)) return this.modules.statsScrolled;
    return false;
  }

  @Builder
  private themeChoice(value: string, label: string, symbol: Resource = $r('sys.symbol.sun_max')) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 7 }) {
        if (value === 'system') {
          Image(this.themePreference === value ? $r('app.media.theme_monitor_active') : $r('app.media.theme_monitor'))
            .width(18).height(18).objectFit(ImageFit.Contain)
        } else {
          SymbolGlyph(symbol).fontSize(18)
            .fontColor([this.themePreference === value ? $r('app.color.primary_active') : $r('app.color.body')])
        }
        Text(label).fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.themePreference === value ? $r('app.color.primary_active') : $r('app.color.body'))
      }.justifyContent(FlexAlign.Center)
    }.layoutWeight(1).height(44).padding(0)
      .backgroundColor(this.themePreference === value ? $r('app.color.primary_tint') : $r('app.color.canvas'))
      .border({ width: 1, color: this.themePreference === value ? $r('app.color.primary') : $r('app.color.hairline') })
      .borderRadius(8).clip(true)
      .onClick(() => this.onSetTheme(value))
  }

  @Builder
  private compactAppSettingsAction(icon: Resource, label: string, onAction: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 7 }) {
        Image(icon).width(18).height(18).colorFilter(iconTint($r('app.color.body')))
        Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
      }.justifyContent(FlexAlign.Center)
    }.width('100%').height(44).padding(0).margin({ top: 14 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      .onClick(() => { this.compactSettingsOpen = false; onAction(); })
  }

  @Builder
  private compactAppSettingsPanel() {
    Column() {
      ActionPanelHeader({ title: '应用设置', showDragBar: true,
        closeLabel: '关闭应用设置', onClose: () => this.compactSettingsOpen = false })
        .margin({ bottom: 12 })
      Row({ space: 8 }) {
        this.themeChoice('system', '跟随系统')
        this.themeChoice('light', '日间', $r('sys.symbol.sun_max'))
        this.themeChoice('dark', '夜间', $r('sys.symbol.moon'))
      }.width('100%')
      this.compactAppSettingsAction($r('app.media.settings_2'), '设置', () => this.onOpenSettings())
      this.compactAppSettingsAction($r('app.media.info'), '关于', () => this.onOpenAbout())
      this.compactAppSettingsAction($r('app.media.circle_help'), '使用帮助', () => this.onOpenHelp())
      this.compactAppSettingsAction($r('app.media.log_out'), '更换服务器', () =>
        this.onChangeServer())
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 18 })
      .alignItems(HorizontalAlign.Center).backgroundColor($r('app.color.canvas'))
  }

  build() {
    AppTopBar({ title: (this.selectedModule === 1) ? '随记' : (this.selectedModule === 2) ? '收藏中心' :
      (this.selectedModule === 3) ? '知识问答' : (this.selectedModule === 4) ? '学习统计' : '学习日志',
      showSearch: this.selectedModule === 0 || (this.selectedModule === 3),
      showDivider: this.showTopBarDivider(),
      onOpenNavigation: () => this.onOpenNavigation(),
      onOpenSearch: () => this.onOpenSearch(),
      onOpenMore: () => this.compactSettingsOpen = true })
      .bindSheet($$this.compactSettingsOpen, this.compactAppSettingsPanel(), {
        preferType: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
        height: SheetSize.FIT_CONTENT,
        dragBar: false, showClose: false, maskColor: $r('app.color.scrim'),
        radius: LengthMetrics.vp(12)
      })
  }

}

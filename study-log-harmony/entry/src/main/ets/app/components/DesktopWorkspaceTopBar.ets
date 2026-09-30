import { WorkspaceBreakpoint, WORKSPACE_TABS, TabDefinition } from '../../common/AppConfig';
import { AppLogo } from '../../common/ui/AppLogo';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { ToolbarDensity, resolveToolbarDensity, toolbarActionsWidth, toolbarActionWidth } from '../../common/ui/ToolbarLayout';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { iconTint } from '../../common/ui/IconTint';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';

@Component
export struct DesktopWorkspaceTopBar {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop selectedModule: number = 0;
  @Prop moduleRequestedTab: number = -1;
  @Prop logSubtitle: string = '日志';
  @Prop themePreference: string = 'system';
  @Prop desktopKeyboardFocus: boolean = false;
  @Link topMoreOpen: boolean;
  @State private desktopFocusedControl: string = '';
  @State private hoveredModule: number = -1;
  @State private desktopTopBarWidth: number = 0;
  @State private desktopToolbarDensity: ToolbarDensity = ToolbarDensity.OVERFLOW;
  @BuilderParam searchContent: () => void;
  @BuilderParam moreActions: () => void;
  onSelect: (index: number) => void = () => {};
  onOpenSearch: () => void = () => {};
  onOpenTheme: () => void = () => {};
  onOpenHelp: () => void = () => {};
  onChangeServer: () => void = () => {};

  @Builder
  private popupContent() { this.moreActions() }

  private showDesktopNavigationLabels(): boolean {
    return this.desktopToolbarDensity === ToolbarDensity.FULL;
  }

  private desktopNavigationWidth(labels: boolean): number {
    return labels ? toolbarActionsWidth(['随记', '收藏', '问答', '统计', '更换服务器']) + 3 * 48 :
      8 * 40 + 7 * 8;
  }

  private desktopSearchWidth(): number {
    const actionsWidth = this.desktopNavigationWidth(this.showDesktopNavigationLabels());
    return Math.max(260, Math.min(384, this.desktopTopBarWidth * 0.27,
      this.desktopTopBarWidth - 208 - actionsWidth - 48));
  }

  @Builder
  private desktopModuleButton(index: number) {
    Button({ type: ButtonType.Normal, stateEffect: false }) {
      Row({ space: 6 }) {
        Image((this.moduleRequestedTab >= 0 ? this.moduleRequestedTab : this.selectedModule) === index ? WORKSPACE_TABS[index].activeIcon : WORKSPACE_TABS[index].icon)
          .width(18).height(18).objectFit(ImageFit.Contain)
        if (this.showDesktopNavigationLabels()) {
          Text(WORKSPACE_TABS[index].label)
            .fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor((this.moduleRequestedTab >= 0 ? this.moduleRequestedTab : this.selectedModule) === index ? $r('app.color.primary_active') : $r('app.color.body'))
        }
      }.justifyContent(FlexAlign.Center)
    }
    .height(40)
    .width(toolbarActionWidth(WORKSPACE_TABS[index].label, this.showDesktopNavigationLabels()))
    .constraintSize({ minWidth: 40 })
    .padding({ left: this.showDesktopNavigationLabels() ? 10 : 8, right: this.showDesktopNavigationLabels() ? 10 : 8 })
    .attributeModifier(new InteractiveSurface(
      (this.moduleRequestedTab >= 0 ? this.moduleRequestedTab : this.selectedModule) === index ||
      (this.desktopKeyboardFocus && this.desktopFocusedControl === `tab_${index}`) ? $r('app.color.primary_tint') : Color.Transparent,
      this.hoveredModule === index,
      (this.moduleRequestedTab >= 0 ? this.moduleRequestedTab : this.selectedModule) === index ||
      (this.desktopKeyboardFocus && this.desktopFocusedControl === `tab_${index}`)))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredModule = hover ? index : -1))
    .border({
      width: 1,
      color: (this.moduleRequestedTab >= 0 ? this.moduleRequestedTab : this.selectedModule) === index || (this.desktopKeyboardFocus && this.desktopFocusedControl === `tab_${index}`) ?
        $r('app.color.primary') : $r('app.color.hairline')
    })
    .borderRadius(8).clip(true)
    .id(`workspace_tab_${index}`)
    .onFocus(() => this.desktopFocusedControl = `tab_${index}`)
    .onBlur(() => {
      if (this.desktopFocusedControl === `tab_${index}`) this.desktopFocusedControl = '';
    })
    .accessibilityText(WORKSPACE_TABS[index].label)
    .bindTips(WORKSPACE_TABS[index].tooltip, WORKSPACE_TIPS)
    .onClick(() => this.onSelect(index))
  }
  build() {
    Row({ space: 12 }) {
      Button({ type: ButtonType.Normal, stateEffect: false }) {
        Row({ space: 10 }) {
          AppLogo({ iconSize: 38, cornerRadius: 8 })
          Column({ space: 2 }) {
            Text('学习日志工作台').fontFamily('HarmonyOS Sans SC')
              .fontSize(15).fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.ink')).maxLines(1)
            Text(this.selectedModule === 0 ?
              this.logSubtitle : WORKSPACE_TABS[this.selectedModule].label)
              .fontFamily('HarmonyOS Sans SC')
              .fontSize(12).fontWeight(FontWeight.Normal).fontColor($r('app.color.muted')).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        }.width('100%')
      }
      .layoutWeight(1)
      .constraintSize({ minWidth: 208 })
      .padding(0)
      .height('100%')
      .backgroundColor(Color.Transparent)
      .border({
        width: 1,
        color: (this.desktopKeyboardFocus && this.desktopFocusedControl === 'tab_0') ? $r('app.color.primary') : Color.Transparent
      })
      .borderRadius(8)
      .id('workspace_tab_0')
      .onFocus(() => this.desktopFocusedControl = 'tab_0')
      .onBlur(() => { if (this.desktopFocusedControl === 'tab_0') this.desktopFocusedControl = ''; })
      .accessibilityText('日志').bindTips('日志', WORKSPACE_TIPS)
      .onClick(() => this.onSelect(0))

      if (this.desktopToolbarDensity === ToolbarDensity.OVERFLOW) {
        ToolbarAction({
          label: '搜索日志内容', showLabel: false, icon: $r('app.media.search'),
          onAction: () => {
            this.onOpenSearch();
          }
        })
      } else {
      Stack({ alignContent: Alignment.TopStart }) {
        this.searchContent()
      }
      .width(this.desktopSearchWidth())
      .constraintSize({ minWidth: 260, maxWidth: 384 })
      .height(42)
      .zIndex(40)
      }

      Row({ space: 8 }) {
        ForEach(WORKSPACE_TABS, (_tab: TabDefinition, index: number) => {
          if (index > 0) this.desktopModuleButton(index)
        }, (tab: TabDefinition) => tab.label)
        Button({ type: ButtonType.Normal }) {
          if (this.themePreference === 'system') {
            Image($r('app.media.theme_monitor')).width(18).height(18).objectFit(ImageFit.Contain)
              .colorFilter(iconTint($r('app.color.body')))
          } else {
            SymbolGlyph(this.themePreference === 'dark' ? $r('sys.symbol.moon') : $r('sys.symbol.sun_max'))
              .fontSize(18).fontColor([$r('app.color.body')])
          }
        }
        .width(40).height(40).padding(0).backgroundColor($r('app.color.surface_soft'))
        .border({
          width: 1,
          color: (this.desktopKeyboardFocus && this.desktopFocusedControl === 'theme') ? $r('app.color.primary') : $r('app.color.hairline')
        }).borderRadius(8).clip(true)
        .id('desktop_theme_button')
        .onFocus(() => this.desktopFocusedControl = 'theme')
        .onBlur(() => { if (this.desktopFocusedControl === 'theme') this.desktopFocusedControl = ''; })
        .accessibilityText('切换主题模式').bindTips('切换主题模式', WORKSPACE_TIPS)
        .onClick(() => this.onOpenTheme())
        Button({ type: ButtonType.Normal }) {
          Image($r('app.media.circle_help')).width(18).height(18).colorFilter(iconTint($r('app.color.body')))
        }
        .width(40).height(40).padding(0).backgroundColor($r('app.color.surface_soft'))
        .border({
          width: 1,
          color: (this.desktopKeyboardFocus && this.desktopFocusedControl === 'help') ? $r('app.color.primary') : $r('app.color.hairline')
        }).borderRadius(8).clip(true)
        .id('desktop_help_button')
        .key('desktop_help_button')
        .onFocus(() => this.desktopFocusedControl = 'help')
        .onBlur(() => { if (this.desktopFocusedControl === 'help') this.desktopFocusedControl = ''; })
        .accessibilityText('使用帮助').bindTips('使用帮助', WORKSPACE_TIPS)
        .onClick(() => this.onOpenHelp())
        ToolbarAction({ label: '更多设置', icon: $r('app.media.more_horizontal'), showLabel: false,
          active: this.topMoreOpen, onAction: () => this.topMoreOpen = !this.topMoreOpen })
          .bindPopup(this.topMoreOpen, { builder: this.popupContent(), placement: Placement.BottomRight,
            enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
            onStateChange: (event) => { if (!event.isVisible) this.topMoreOpen = false; } })
        Button({ type: ButtonType.Normal }) {
          Row({ space: 6 }) {
            Image($r('app.media.log_out')).width(17).height(17).colorFilter(iconTint($r('app.color.body')))
            if (this.showDesktopNavigationLabels()) {
              Text('更换服务器').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
                .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
            }
          }.justifyContent(FlexAlign.Center)
        }
        .height(40).constraintSize({ minWidth: 40 }).padding({ left: 9, right: 9 })
        .backgroundColor(Color.Transparent)
        .border({
          width: 1,
          color: (this.desktopKeyboardFocus && this.desktopFocusedControl === 'logout') ? $r('app.color.primary') : Color.Transparent
        })
        .borderRadius(8)
        .id('desktop_logout_button')
        .onFocus(() => this.desktopFocusedControl = 'logout')
        .onBlur(() => { if (this.desktopFocusedControl === 'logout') this.desktopFocusedControl = ''; })
        .accessibilityText('更换服务器').bindTips(this.showDesktopNavigationLabels() ? undefined : '更换服务器', WORKSPACE_TIPS)
        .onClick(() => { this.onChangeServer(); })
      }.height('100%')
    }
    .width('100%').height(64)
    .padding({ left: 12, right: 12 })
    .backgroundColor($r('app.color.canvas'))
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
    .justifyContent(FlexAlign.Start)
    .zIndex(30)
    .onAreaChange((_oldArea, area) => {
      this.desktopTopBarWidth = Number(area.width);
      const reservedWidth = 208 + 260 + 48;
      this.desktopToolbarDensity = resolveToolbarDensity(this.desktopTopBarWidth,
        reservedWidth + this.desktopNavigationWidth(false), reservedWidth + this.desktopNavigationWidth(true),
        this.desktopToolbarDensity);
    })
  }

}

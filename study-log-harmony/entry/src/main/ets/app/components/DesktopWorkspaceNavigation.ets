import { WORKSPACE_TABS, WorkspaceBreakpoint } from '../../common/AppConfig';
import { WorkspaceModuleState } from '../WorkspaceModuleState';
import { animateHover } from '../../common/ui/InteractiveSurface';
import { iconTint } from '../../common/ui/IconTint';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';

@Component
export struct DesktopWorkspaceNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @ObjectLink modules: WorkspaceModuleState;
  @Prop selectedModule: number = 0;
  @Prop collapsed: boolean = false;
  @Prop sidebarAnimating: boolean = false;
  @Prop sidebarExpansion: number = 1;
  @Prop sidebarWidth: number = 220;
  @Link railPopover: string;
  @State private navigationRailHover: string = '';
  @BuilderParam navigationContent: () => void;
  @BuilderParam filtersContent: () => void;
  @BuilderParam popoverContent: () => void;
  onExpand: (section: number) => void = () => {};
  onCollapse: () => void = () => {};
  onNewQuestion: () => void = () => {};
  onOpenTaxonomy: () => void = () => {};
  onToday: () => void = () => {};
  onHeight: (height: number) => void = () => {};

  @Builder
  private railPopoverPanel() { this.popoverContent() }

  @Builder
  private navigationRailButton(id: string, icon: Resource, label: string, action: () => void,
    active: boolean = false, enabled: boolean = true) {
    Button({ type: ButtonType.Normal }) {
      Image(icon).width(id === 'expand' ? 18 : 17).height(id === 'expand' ? 18 : 17)
        .objectFit(ImageFit.Contain)
        .colorFilter(iconTint(active || this.navigationRailHover === id || id === 'expand' ?
          $r('app.color.ink') : $r('app.color.muted')))
    }.id(`sidebar_rail_${id}`).width(38).height(38).padding(0).borderRadius(8)
      .backgroundColor(active ? $r('app.color.surface_card') : this.navigationRailHover === id ?
        $r('app.color.interaction_hover') : $r('app.color.interaction_hover_clear'))
      .hoverEffect(HoverEffect.None)
      .onHover((hovered: boolean) => animateHover(this.getUIContext(), () => this.navigationRailHover = hovered ? id : ''))
      .enabled(enabled).accessibilityText(label).bindTips(label, WORKSPACE_TIPS).onClick(action)
      .bindPopup(this.railPopover === id, {
        builder: this.railPopoverPanel(), placement: Placement.RightTop, enableArrow: false,
        popupColor: $r('app.color.canvas'), radius: 10, autoCancel: true,
        backgroundBlurStyle: BlurStyle.NONE, targetSpace: 6,
        shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
        onStateChange: (event) => { if (!event.isVisible && this.railPopover === id) this.railPopover = ''; }
      })
  }

  @Builder
  private desktopNavigationRail() {
    Column({ space: 8 }) {
      this.navigationRailButton('expand', $r('app.media.rail_chevron_right'), '展开侧栏',
        () => { this.railPopover = ''; this.onExpand(-1); })
      if ((this.selectedModule === 3)) {
        this.navigationRailButton('new_question', $r('app.media.rail_square_pen'), '新建问答',
          () => { this.railPopover = ''; this.onNewQuestion(); }, false, !this.modules.qaBusy)
        this.navigationRailButton('search', $r('app.media.rail_search'), '搜索历史',
          () => this.railPopover = this.railPopover === 'search' ? '' : 'search', this.railPopover === 'search')
        this.navigationRailButton('recent', $r('app.media.rail_message_square_text'), '最近问答',
          () => { this.modules.qaQuery = ''; this.railPopover = this.railPopover === 'recent' ? '' : 'recent'; },
          this.railPopover === 'recent')
      } else if ((this.selectedModule === 1)) {
        this.navigationRailButton('new_note', $r('app.media.rail_plus'), '新建随记',
          () => { this.railPopover = ''; this.modules.noteNewRevision++; }, false, !this.modules.notesBusy)
        this.navigationRailButton('tags', $r('app.media.rail_tag'), '年份和标签',
          () => this.railPopover = this.railPopover === 'tags' ? '' : 'tags', this.railPopover === 'tags')
      } else if ((this.selectedModule === 2)) {
        this.navigationRailButton('favorite_filters', $r('app.media.tab_star'), '筛选收藏',
          () => this.railPopover = this.railPopover === 'favorite_filters' ? '' : 'favorite_filters',
          this.railPopover === 'favorite_filters')
      } else if ((this.selectedModule === 4)) {
        this.navigationRailButton('stats_months', $r('app.media.rail_calendar_days'), '选择统计月份',
          () => this.railPopover = this.railPopover === 'stats_months' ? '' : 'stats_months',
          this.railPopover === 'stats_months')
        this.navigationRailButton('taxonomy', $r('app.media.settings_2'), '分类管理',
          () => { this.railPopover = ''; this.onOpenTaxonomy(); })
      } else {
      this.navigationRailButton('months', $r('app.media.rail_calendar_days'), '展开月份列表',
        () => this.onExpand(0))
      this.navigationRailButton('dates', $r('app.media.rail_file_text'), '展开日期列表',
        () => this.onExpand(2))
      this.navigationRailButton('today', $r('app.media.rail_plus'), '新建今日日志',
        () => this.onToday())
      }
    }.id('sidebar_rail').width('100%').height('100%')
      .alignItems(HorizontalAlign.Center).padding({ top: 14, bottom: 14 })
  }

  @Builder
  private moduleNavigationHeader() {
    Row({ space: 6 }) {
      Image(WORKSPACE_TABS[this.selectedModule].activeIcon).width(19).height(19).objectFit(ImageFit.Contain)
      Text((this.selectedModule === 1) ? '随记' : (this.selectedModule === 2) ? '收藏中心' : (this.selectedModule === 3) ? '知识问答' : '学习统计')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong')).layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      this.filtersContent()
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(16).fontColor([$r('app.color.body')])
      }.width(34).height(34).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
        .id('sidebar_collapse').accessibilityText('折叠侧栏').bindTips('折叠侧栏', WORKSPACE_TIPS)
        .onClick(() => this.onCollapse())
    }.width('100%').height(52).padding({ left: 16, right: 10 })
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        if (this.selectedModule !== 0) this.moduleNavigationHeader()
        this.navigationContent()
      }
        .width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
        .height('100%')
        .opacity(this.sidebarAnimating ? this.sidebarExpansion :
          (this.collapsed ? 0 : 1))
        .visibility(!this.collapsed || this.sidebarAnimating ?
          Visibility.Visible : Visibility.Hidden)
        .hitTestBehavior(this.collapsed || this.sidebarAnimating ?
          HitTestMode.None : HitTestMode.Default)
        .accessibilityLevel(this.collapsed ? 'no-hide-descendants' : 'auto')
      Column() { this.desktopNavigationRail() }.width(52).height('100%')
        .opacity(this.sidebarAnimating ? 1 - this.sidebarExpansion :
          (this.collapsed ? 1 : 0))
        .visibility(this.collapsed || this.sidebarAnimating ?
          Visibility.Visible : Visibility.Hidden)
        .hitTestBehavior(!this.collapsed || this.sidebarAnimating ?
          HitTestMode.None : HitTestMode.Default)
        .accessibilityLevel(this.collapsed ? 'auto' : 'no-hide-descendants')
    }.width(this.sidebarWidth)
      .height('100%').backgroundColor($r('app.color.surface_soft'))
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
      .clip(this.sidebarAnimating)
      .border({ width: { right: 1 }, color: $r('app.color.hairline') })
      .id('desktop_navigation_frame').zIndex(this.railPopover ? 40 : 1)
      .onAreaChange((_: Area, area: Area) => this.onHeight(Number(area.height)))
  }
}

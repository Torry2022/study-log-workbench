import { WorkspaceLogNavigation } from './WorkspaceLogNavigation';
import { LogNavigationController } from '../../features/logs/LogNavigationController';
import { DaySummary } from '../../features/logs/LogModels';
import { DesktopWorkspaceTopBar } from './DesktopWorkspaceTopBar';
import { CompactWorkspaceTopBar } from './CompactWorkspaceTopBar';
import { WorkspaceSidebarState } from '../WorkspaceSidebarState';
import { WorkspaceBreakpoint, WORKSPACE_TABS } from '../../common/AppConfig';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { NavigationRefresh } from '../../common/ui/NavigationRefresh';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { DesktopWorkspaceNavigation } from './DesktopWorkspaceNavigation';
import { WorkspaceModuleNavigation } from './WorkspaceModuleNavigation';
import { RagSessionSummary } from '../../features/qa/QaModels';
import { WorkspaceSearchController } from '../WorkspaceSearchController';
import { LogSearchPanel, LogSearchResult } from '../../features/logs/LogSearchPanel';
import { WorkspaceNavigationCommands } from '../WorkspaceNavigationBridge';
import { WorkspaceFrame } from './WorkspaceFrame';
import { WorkspaceContent, WorkspaceTaxonomyPage } from './WorkspaceContent';
import { DesktopThemePanel } from './DesktopThemePanel';
import { WorkspaceModuleState } from '../WorkspaceModuleState';
import { WorkspaceReadingState } from '../WorkspaceReadingState';
import { ReadingTransitionCoordinator } from '../ReadingTransitionCoordinator';
import { WorkspaceTransitionCoordinator } from '../WorkspaceTransitionCoordinator';
import { FavoritesController } from '../../features/favorites/FavoritesController';
import { FavoriteHeading } from '../../features/favorites/FavoriteModels';
import { QaNavigationController } from '../../features/qa/QaNavigationController';
import { StatsEntry } from '../../features/stats/StatsModels';
import { LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { DelayedLoadingHint } from '../../common/ui/DelayedLoadingHint';
import { floatingSurfaceTransition, secondaryPageTransition } from '../../common/ui/WorkspaceMotion';

@Component
export struct WorkspaceSurface {
  @ObjectLink modules: WorkspaceModuleState;
  @ObjectLink reading: WorkspaceReadingState;
  @ObjectLink readingTransition: ReadingTransitionCoordinator;
  @ObjectLink workspaceTransition: WorkspaceTransitionCoordinator;
  @ObjectLink favoritesData: FavoritesController;
  @ObjectLink qaNavigation: QaNavigationController;
  @Prop selectedModule: number = 0;
  @Prop wide: boolean = false;
  @Prop sidebarWidth: number = 220;
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @ObjectLink sidebar: WorkspaceSidebarState;
  @Link railPopover: string;
  @Link moduleFrameHeight: number;
  onToday: () => void = () => {};
  @Prop keyboardVisible: boolean = false;
  @Prop themePreference: string = 'system';
  @Prop logLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  onWorkspaceKey: (event: KeyEvent) => boolean = () => false;
  @Link desktopThemeOpen: boolean;
  @Link topMoreOpen: boolean;
  @Link compactSettingsOpen: boolean;
  @Link searchFocusRevision: number;
  @Prop desktopKeyboardFocus: boolean = false;
  @Prop desktopWindowChrome: boolean = false;
  @Prop logSubtitle: string = '日志';
  @Link calendarOpen: boolean;
  onBeforeAppAction: () => void = () => {};
  @ObjectLink logNavigation: LogNavigationController;
  @Prop selectedDate: string = '';
  @Link navigationMonthsExpanded: boolean;
  @Link navigationDayQuery: string;
  @Link newLogDate: string;
  @Link calendarMode: string;
  logNavigationScroller: Scroller = new Scroller();
  onOpenCalendar: (mode: string) => void = () => {};
  onLogMonth: (month: string) => void = () => {};
  onLogDay: (date: string) => void = () => {};
  onLogHeading: (day: DaySummary, heading: string, index: number) => void = () => {};
  onLogDate: (date: string) => void = () => {};
  onNewLog: (date: string) => void = () => {};
  onLogRetry: () => void = () => {};
  @BuilderParam logContent: () => void;
  @ObjectLink search: WorkspaceSearchController;
  @Link searchOpen: boolean;
  onSelect: (index: number) => void = () => {};
  @Link navigationCommands: WorkspaceNavigationCommands;
  onOpenTaxonomy: () => void = () => {};
  onCloseTaxonomy: () => void = () => {};
  onContentArea: (area: Area) => void = () => {};
  onWorkspaceArea: (area: Area) => void = () => {};

  @Builder
  private logNavigationContent() {
    WorkspaceLogNavigation({ logNavigation: this.logNavigation, selectedDate: this.selectedDate, wide: this.wide,
      navigationMonthsExpanded: $navigationMonthsExpanded, navigationDayQuery: $navigationDayQuery,
      newLogDate: $newLogDate, calendarMode: $calendarMode, calendarOpen: $calendarOpen,
      logNavigationScroller: this.logNavigationScroller,
      onCollapse: () => this.navigationCommands.sidebarCollapsed(true, -1),
      onOpenCalendar: this.onOpenCalendar, onMonth: this.onLogMonth, onDay: this.onLogDay, onHeading: this.onLogHeading,
      onOpenDate: this.onLogDate, onNewLog: this.onNewLog, onRetry: this.onLogRetry })
  }

  private changeSearch(query: string, reset: boolean = false): void { this.search.changeLogSearchQuery(query, reset); }
  private closeSearch(): void { this.searchOpen = false; this.search.dismissSearchResults(); }

  private showSearchHistory(): boolean { return this.search.showSearchHistory(); }

  private updateSearchHistory(items: string[]): void { this.search.updateSearchHistory(items); }

  private selectSearchHistory(query: string): void {
    this.changeSearch(query);
    this.searchLogs();
  }

  private async searchLogs(): Promise<void> { await this.search.searchLogs(); }

  @Builder
  private searchOverlay() {
      if (this.searchOpen && !this.wide) {
        LogSearchPanel({ query: this.search.searchQuery, headingsOnly: this.search.searchHeadingsOnly,
            ignoreCase: this.search.searchIgnoreCase, loading: this.search.searchLoading,
            submitted: this.search.searchSubmitted, error: this.search.searchError, results: this.search.searchResults,
            searchHistory: this.search.searchHistory, showHistory: this.showSearchHistory(),
            onHistorySelect: (query: string) => this.selectSearchHistory(query),
            onHistoryRemove: (query: string) => this.updateSearchHistory(
              this.search.searchHistory.filter((entry: string) => entry !== query)),
            onHistoryClear: () => this.updateSearchHistory([]),
          onClose: () => this.closeSearch(), onQuery: (query: string) => this.changeSearch(query),
          onSearch: () => this.searchLogs(),
          onHeadings: () => { this.search.searchHeadingsOnly = !this.search.searchHeadingsOnly; this.changeSearch(this.search.searchQuery, true); },
          onCase: () => { this.search.searchIgnoreCase = !this.search.searchIgnoreCase; this.changeSearch(this.search.searchQuery, true); },
          onSelect: (result: LogSearchResult) => this.navigationCommands.searchResult(result) })
          .width('100%').height('100%').transition(secondaryPageTransition())
      }
  }

  private closeNavigation(): void { this.railPopover = ''; this.navigationCommands.navigation(false); }

  @Builder
  private moduleNavigationContent(popover: boolean = false) {
    WorkspaceModuleNavigation({ selectedModule: this.selectedModule, modules: this.modules,
      qaNavigation: this.qaNavigation, favoritesData: this.favoritesData,
      railPopover: $railPopover, moduleFrameHeight: this.moduleFrameHeight,
      wide: true, popover: popover,
      onSession: (id: string) => this.navigationCommands.qaSession(id, false),
      onDelete: (session: RagSessionSummary) => this.navigationCommands.qaDelete(session),
      onTaxonomy: () => this.navigationCommands.openTaxonomy(), onCloseNavigation: () => this.closeNavigation(),
      logContent: (): void => this.logNavigationContent() })
  }

  @Builder
  private refreshableNavigationContent() {
    NavigationRefresh({ onRefresh: (): Promise<void> => this.navigationCommands.refreshNavigation(),
      content: (): void => this.moduleNavigationContent() })
  }

  @Builder
  private refreshableCompactNavigationContent() {
    NavigationRefresh({ onRefresh: (): Promise<void> => this.navigationCommands.refreshNavigation(),
      content: (): void => this.compactNavigationContent() })
  }

  private hasNavigationFilters(): boolean {
    if ((this.selectedModule === 1)) return this.modules.noteYearFilter !== 'all' || this.modules.noteTagFilter !== 'all';
    if ((this.selectedModule === 2)) return this.favoritesData.selectedGroup !== 'all' || this.favoritesData.selectedMonth !== 'all';
    if ((this.selectedModule === 4)) return this.modules.statsMonths.length > 0 && this.modules.statsMonth !== this.modules.statsMonths[0].id;
    return false;
  }

  private resetNavigationFilters(): void {
    if ((this.selectedModule === 1)) { this.modules.noteYearFilter = 'all'; this.modules.noteTagFilter = 'all'; }
    else if ((this.selectedModule === 2)) { this.favoritesData.selectGroup('all'); this.favoritesData.selectMonth('all'); }
    else if ((this.selectedModule === 4) && this.modules.statsMonths.length > 0) {
      this.modules.statsMonth = this.modules.statsMonths[0].id; this.modules.statsMonthRevision++;
    }
  }

  @Builder
  private navigationFilterReset(id: string = 'navigation_reset_filters') {
    if ((this.selectedModule === 1) || (this.selectedModule === 2) || (this.selectedModule === 4)) {
      Button('重置筛选', { type: ButtonType.Normal }).id(id).width(64).height(34).padding(0)
        .fontSize(12).fontColor($r('app.color.muted')).backgroundColor(Color.Transparent).borderRadius(8)
        .visibility(this.hasNavigationFilters() ? Visibility.Visible : Visibility.Hidden)
        .onClick(() => this.resetNavigationFilters())
    }
  }


  @Builder
  private desktopNavigation() {
    DesktopWorkspaceNavigation({ modules: this.modules, selectedModule: this.selectedModule,
      collapsed: this.sidebar.collapsedModules[this.selectedModule], sidebarAnimating: this.sidebar.sidebarAnimating,
      sidebarExpansion: this.sidebar.sidebarExpansion, sidebarWidth: this.sidebarWidth,
      railPopover: $railPopover, onExpand: (section: number) => this.navigationCommands.sidebarCollapsed(false, section),
      onCollapse: () => this.navigationCommands.sidebarCollapsed(true, -1),
      onNewQuestion: () => this.navigationCommands.qaSession('', false),
      onOpenTaxonomy: () => this.navigationCommands.openTaxonomy(),
      onToday: () => this.onToday(),
      onHeight: (height: number) => this.moduleFrameHeight = height,
      navigationContent: (): void => this.refreshableNavigationContent(),
      filtersContent: (): void => this.navigationFilterReset(),
      popoverContent: (): void => this.railPopoverPanel() })
  }

  @Builder
  private railPopoverPanel() {
    if ((this.selectedModule === 3)) {
      this.moduleNavigationContent(true)
    } else {
      Column() {
        Row() {
        Text((this.selectedModule === 1) ? '年份和标签' : (this.selectedModule === 2) ? '筛选收藏' : '统计月份')
          .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          .layoutWeight(1)
        this.navigationFilterReset('navigation_popover_reset_filters')
        }.width('100%').height(48).padding({ left: 14, right: 14 })
        this.moduleNavigationContent(true)
      }.width(280).height(Math.min(420, Math.max(180, this.moduleFrameHeight - 32)))
    }
  }

  @Builder
  private compactNavigationContent() {
    WorkspaceModuleNavigation({ selectedModule: this.selectedModule, modules: this.modules,
      qaNavigation: this.qaNavigation, favoritesData: this.favoritesData,
      railPopover: $railPopover, moduleFrameHeight: this.moduleFrameHeight,
      wide: false, popover: false,
      onSession: (id: string) => this.navigationCommands.qaSession(id, false),
      onDelete: (session: RagSessionSummary) => this.navigationCommands.qaDelete(session),
      onTaxonomy: () => this.navigationCommands.openTaxonomy(), onCloseNavigation: () => this.closeNavigation(),
      logContent: (): void => this.logNavigationContent() })
  }

  @Builder
  private compactNavigationHeader() {
    Column({ space: 1 }) {
      Row({ space: 10 }) {
        Image(WORKSPACE_TABS[this.selectedModule].activeIcon).width(20).height(20).objectFit(ImageFit.Contain)
        Text((this.selectedModule === 1) ? '随记' : (this.selectedModule === 2) ? '收藏中心' : (this.selectedModule === 3) ? '知识问答' :
          (this.selectedModule === 4) ? '学习统计' : '学习日志')
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(15)
          .fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
          .maxLines(1).layoutWeight(1)
        this.navigationFilterReset()
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([$r('app.color.body')])
        }.width(40).height(40).padding(0).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
          .onClick(() => this.closeNavigation())
          .id('navigation_drawer_close').accessibilityText('关闭侧栏').bindTips('关闭侧栏', WORKSPACE_TIPS)
      }.width('100%').height(40)
      Text((this.selectedModule === 1) ? '按年份和标签筛选' : (this.selectedModule === 2) ? '按分组和日志月份筛选' :
        (this.selectedModule === 3) ? '历史会话' : (this.selectedModule === 4) ? '切换月份与管理分类' : '按月份和日期浏览')
        .fontSize(11).fontColor($r('app.color.muted')).maxLines(1).margin({ left: 30 })
    }.width('100%').height(64).padding({ left: 18, right: 12 }).alignItems(HorizontalAlign.Start)
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }

  @Builder
  private navigationOverlay() {
      if (!this.wide && this.sidebar.navigationOpen) {
        Stack({ alignContent: Alignment.Start }) {
          AppModalScrim({ onDismiss: () => this.closeNavigation() })
            .opacity(this.sidebar.navigationScrimOpacity)
          Row().width('82%').height('100%').backgroundColor($r('app.color.surface_soft'))
            .border({ width: { right: 1 }, color: $r('app.color.hairline') })
            .shadow({ radius: 18, color: '#24141413', offsetX: 4 })
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
            .translate({ x: this.sidebar.navigationOffset })
          Column() {
            this.compactNavigationHeader()
            this.refreshableCompactNavigationContent()
          }.width('82%').height('100%')
            .backgroundColor($r('app.color.surface_soft'))
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
            .translate({ x: this.sidebar.navigationOffset })
        }.width('100%').height('100%')
      }
  }

  @Builder
  private desktopTopBar() {
    DesktopWorkspaceTopBar({ selectedModule: this.selectedModule, topMoreOpen: $topMoreOpen,
      logSubtitle: this.logSubtitle,
      onSelect: (index: number) => this.onSelect(index),
      themePreference: this.themePreference, desktopKeyboardFocus: this.desktopKeyboardFocus,
      moduleRequestedTab: this.modules.moduleRequestedTab,
      onOpenTheme: () => { this.topMoreOpen = false; this.desktopThemeOpen = !this.desktopThemeOpen; },
      onOpenHelp: () => this.navigationCommands.help(),
      onChangeServer: () => this.navigationCommands.changeServer(),
      onOpenSearch: () => { this.searchOpen = true; this.searchFocusRevision++; },
      search: this.search, searchOpen: $searchOpen, searchFocusRevision: this.searchFocusRevision,
      calendarOpen: this.calendarOpen, moduleFrameHeight: this.moduleFrameHeight,
      onSearchResult: (result: LogSearchResult) => this.navigationCommands.searchResult(result),
      onOpenSettings: () => { this.onBeforeAppAction(); this.navigationCommands.settings(); },
      onOpenAbout: () => { this.onBeforeAppAction(); this.navigationCommands.about(); } })
  }

  @Builder
  private compactTopBar() {
    CompactWorkspaceTopBar({ modules: this.modules, selectedModule: this.selectedModule,
      desktopWindowChrome: this.desktopWindowChrome, themePreference: this.themePreference,
      compactSettingsOpen: $compactSettingsOpen,
      onOpenNavigation: () => this.navigationCommands.navigation(true), onOpenSearch: () => this.navigationCommands.openSearch(),
      onSetTheme: (value: string) => this.navigationCommands.theme(value),
      onOpenSettings: () => this.navigationCommands.settings(), onOpenAbout: () => this.navigationCommands.about(),
      onOpenHelp: () => this.navigationCommands.help(),
      onChangeServer: () => this.navigationCommands.changeServer() })
  }

  private preparationHint(): LoadingHintPlacement {
    switch (this.selectedModule) {
      case 1: return this.modules.notesLoadingHint;
      case 2: return this.modules.favoritesLoadingHint;
      case 3: return this.modules.qaLoadingHint;
      case 4: return this.modules.statsLoadingHint;
      default: return this.logLoadingHint;
    }
  }

  @Builder
  private workspaceContent() {
    WorkspaceContent({ modules: this.modules, favoritesData: this.favoritesData, qaNavigation: this.qaNavigation,
      onWorkspaceKey: (event: KeyEvent) => this.onWorkspaceKey(event),
      selectedModule: this.selectedModule, outgoingTab: this.modules.outgoingTab, moduleReveal: this.modules.moduleReveal,
      wide: this.wide, themePreference: this.themePreference,
      onSelect: (index: number) => this.onSelect(index),
      onCitation: (date: string, heading: string, index: number) => this.navigationCommands.citation(date, heading, index),
      onNoteLink: (date: string, heading: string) => this.navigationCommands.noteLink(date, heading),
      onFavorite: (favorite: FavoriteHeading) => this.navigationCommands.favorite(favorite),
      onStatsEntry: (entry: StatsEntry) => this.navigationCommands.statsEntry(entry),
      onOpenTaxonomy: () => this.onOpenTaxonomy(),
      onCloseTaxonomy: () => this.onCloseTaxonomy(),
      logContent: (): void => this.logContent() })
  }

  build() {
    Stack() {
      WorkspaceFrame({ wide: this.wide, readingMode: this.reading.logsReadingMode,
        readingProgress: this.reading.readingProgress, readingAnimating: this.readingTransition.animating,
        sidebarWidth: this.sidebarWidth, sidebarPopover: !!this.railPopover,
        keyboardVisible: this.keyboardVisible, selectedModule: this.selectedModule,
        coordinator: this.workspaceTransition,
        desktopTopBar: () => { this.desktopTopBar() }, compactTopBar: () => { this.compactTopBar() },
        navigation: () => { this.desktopNavigation() }, content: () => { this.workspaceContent() },
        onSelect: (index: number) => this.onSelect(index),
        onContentArea: (area: Area) => this.onContentArea(area),
        onWorkspaceArea: (area: Area) => this.onWorkspaceArea(area) })
      if (this.wide && this.desktopThemeOpen) {
        DesktopThemePanel({ themePreference: this.themePreference,
          onSetTheme: (value: string) => this.navigationCommands.theme(value),
          onClose: () => this.desktopThemeOpen = false })
      }
      DelayedLoadingHint({ loading: this.selectedModule === 0 && this.logLoadingHint.loading,
        text: '正在加载日志…' })
        .width(this.logLoadingHint.width).height(this.logLoadingHint.height)
        .position({ x: this.logLoadingHint.x - this.reading.workspaceOriginX,
          y: this.logLoadingHint.y - this.reading.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedModule === 3 && this.modules.qaLoadingHint.loading,
        text: '正在读取会话…' })
        .width(this.modules.qaLoadingHint.width).height(this.modules.qaLoadingHint.height)
        .position({ x: this.modules.qaLoadingHint.x - this.reading.workspaceOriginX,
          y: this.modules.qaLoadingHint.y - this.reading.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedModule === 1 && this.modules.notesLoadingHint.loading,
        text: '正在加载随记…' })
        .width(this.modules.notesLoadingHint.width).height(this.modules.notesLoadingHint.height)
        .position({ x: this.modules.notesLoadingHint.x - this.reading.workspaceOriginX,
          y: this.modules.notesLoadingHint.y - this.reading.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedModule === 2 && this.modules.favoritesLoadingHint.loading,
        text: '正在加载收藏…' })
        .width(this.modules.favoritesLoadingHint.width).height(this.modules.favoritesLoadingHint.height)
        .position({ x: this.modules.favoritesLoadingHint.x - this.reading.workspaceOriginX,
          y: this.modules.favoritesLoadingHint.y - this.reading.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      if (this.selectedModule === 4 && !this.modules.taxonomyOpen) {
        DelayedLoadingHint({ loading: this.modules.statsLoadingHint.loading,
          text: '正在加载统计…' })
          .width(this.modules.statsLoadingHint.width).height(this.modules.statsLoadingHint.height)
          .position({ x: this.modules.statsLoadingHint.x - this.reading.workspaceOriginX,
            y: this.modules.statsLoadingHint.y - this.reading.workspaceOriginY })
          .zIndex(20).hitTestBehavior(HitTestMode.None)
      }
      DelayedLoadingHint({ loading: (this.workspaceTransition.waitingKind === 'mode' ||
        this.workspaceTransition.waitingKind === 'module') &&
        !this.preparationHint().loading && this.preparationHint().width > 0,
        text: '正在准备页面…' })
        .width(this.preparationHint().width).height(this.preparationHint().height)
        .position({ x: this.preparationHint().x - this.reading.workspaceOriginX,
          y: this.preparationHint().y - this.reading.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
        .transition(floatingSurfaceTransition())
      if (this.readingTransition.snapshot) {
        Stack({ alignContent: Alignment.TopStart }) {
          Image(this.readingTransition.snapshot).width(this.reading.readingImageWidth).height(this.reading.readingImageHeight)
            .constraintSize({ minWidth: this.reading.readingImageWidth, minHeight: this.reading.readingImageHeight })
            .objectFit(ImageFit.Fill).syncLoad(true).translate({ x: this.reading.readingImageInset })
            .onComplete(() => this.readingTransition.rendered())
            .onError(() => this.readingTransition.clear())
        }.width(this.reading.readingCoverWidth).height(this.reading.readingCoverHeight)
          .position({ x: this.reading.readingCoverX, y: this.reading.readingCoverY })
          .backgroundColor($r('app.color.canvas')).clip(true).zIndex(5)
          .hitTestBehavior(HitTestMode.None)
      }
      if (this.workspaceTransition.snapshot && this.workspaceTransition.kind !== 'module') {
        Image(this.workspaceTransition.snapshot).width('100%').height('100%')
          .objectFit(ImageFit.Fill).syncLoad(true).opacity(this.workspaceTransition.opacity).zIndex(10)
          .onComplete(() => this.workspaceTransition.rendered())
          .onError(() => this.workspaceTransition.clear())
          .hitTestBehavior(HitTestMode.None)
      }
      if (!this.wide && this.modules.taxonomyOpen) {
        WorkspaceTaxonomyPage({ modules: this.modules,
          onBack: () => this.onCloseTaxonomy() }).width('100%').height('100%').zIndex(7).transition(secondaryPageTransition())
      }
      this.navigationOverlay()
      this.searchOverlay()
    }.width('100%').height('100%')
  }
}

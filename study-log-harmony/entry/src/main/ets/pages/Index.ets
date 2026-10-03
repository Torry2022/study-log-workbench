import { WorkspaceSurface } from '../app/components/WorkspaceSurface';
import { LogSession } from '../features/logs/LogSession';
import { LoadingHintPlacement } from '../common/ui/LoadingHintAnchor';
import { NavigationRefreshController, NavigationSnapshot } from '../app/NavigationRefreshController';
import { LogSearchResult } from '../features/logs/LogSearchPanel';
import { DaySummary, LogSourceTarget } from '../features/logs/LogModels';
import { FavoriteHeading } from '../features/favorites/FavoriteModels';
import { StatsEntry } from '../features/stats/StatsModels';
import { WorkspaceSidebarState } from '../app/WorkspaceSidebarState';
import { WorkspaceReadingState } from '../app/WorkspaceReadingState';
import { ReadingTransitionCoordinator } from '../app/ReadingTransitionCoordinator';
import { KeyboardAvoidMode } from '@kit.ArkUI';
import { fileIo } from '@kit.CoreFileKit';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { WorkspaceBreakpoint, READING_MAX_WIDTH, THEME_PREFERENCES } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance } from '../common/network/InstanceConfig';
import { apiClient } from '../common/network/ApiClient';
import { LogNavigationController } from '../features/logs/LogNavigationController';
import { WorkspaceSearchController } from '../app/WorkspaceSearchController';
import { LogSearchRepository } from '../features/logs/LogSearchRepository';
import { WorkspaceNavigationView, WorkspaceNavigationCommands } from '../app/WorkspaceNavigationBridge';
import { WorkspaceTransitionCoordinator } from '../app/WorkspaceTransitionCoordinator';
import { FrameAction } from '../common/ui/FrameAction';
import { WorkspaceModuleState } from '../app/WorkspaceModuleState';
import { FavoritesController } from '../features/favorites/FavoritesController';
import { RagSessionSummary } from '../features/qa/QaModels';
import { QaNavigationController } from '../features/qa/QaNavigationController';
import { LoginPage } from '../app/LoginPage';
import { TokenStore } from '../common/storage/TokenStore';
import { LogsReaderPage, PreservedLogDraft } from '../features/logs/LogsReaderPage';
import { logDraftStore } from '../features/logs/LogDraftStore';
import { noteDraftStore } from '../features/notes/NoteDraftStore';
import { taxonomyDraftStore } from '../features/stats/TaxonomyDraftStore';
import { DesktopLogCommands, DesktopMenuEntry } from '../app/DesktopMenu';
import { DesktopTitleBar } from '../app/components/DesktopTitleBar';
import { ImagePreview } from '../common/ui/ImagePreview';
import { appFeedback } from '../common/ui/AppFeedback';
import { workspacePreferences } from '../common/storage/WorkspacePreferences';
import { SettingsPanel } from '../app/components/SettingsPanel';
import { AboutPanel } from '../app/components/AboutPanel';
import { HelpPanel } from '../app/components/HelpPanel';
import { LaunchIntro } from '../app/components/LaunchIntro';
import { KeyCode } from '@kit.InputKit';
import { workspaceKey } from '../common/ui/WorkspaceKeys';
import { revealPanel, floatingSurfaceTransition } from '../common/ui/WorkspaceMotion';

@Entry
@Component
struct Index {
  @Provide('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.COMPACT;
  @State private logSession: LogSession = new LogSession();
  @State private logLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  @State private workspaceCommands: WorkspaceNavigationCommands = new WorkspaceNavigationCommands();
  @StorageProp('softwareKeyboardVisible') private softwareKeyboardVisible: boolean = false;
  @State private navigationMonthsExpanded: boolean = false;
  @State private navigationDayQuery: string = '';
  @State private newLogDate: string = '';
  @State private calendarMode: string = 'create';
  @State private calendarOpen: boolean = false;
  private logNavigationScroller: Scroller = new Scroller();
  @State private railPopover: string = '';
  @State private moduleFrameHeight: number = 0;
  @State private searchFocusRevision: number = 0;
  @State private topMoreOpen: boolean = false;
  @State private desktopThemeOpen: boolean = false;
  @State private desktopKeyboardFocus: boolean = false;
  @State private compactSettingsOpen: boolean = false;
  @State private connected: boolean = false;
  @State private launchCoverVisible: boolean = true;
  @State private launchReady: boolean = false;
  @State private selectedModule: number = 0;
  @State private modules: WorkspaceModuleState = new WorkspaceModuleState();
  @State private favoritesData: FavoritesController = new FavoritesController(apiClient);
  @State private qaNavigation: QaNavigationController = this.createQaNavigation();
  @State private search: WorkspaceSearchController = this.createWorkspaceSearch();
  @State private searchOpen: boolean = false;
  @State private logNavigation: LogNavigationController = new LogNavigationController();
  @StorageProp('pref_rememberSearch') private rememberSearch: boolean = true;
  @State private restoreOnAppear: boolean = true;
  @StorageLink('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  @StorageLink('themePreference') private themePreference: string = 'system';
  @StorageLink('previewImageSource') private previewImageSource: string = '';
  @State private imagePreviewOpacity: number = 0;
  @State private settingsOpen: boolean = false;
  @State private aboutOpen: boolean = false;
  @State private helpOpen: boolean = false;
  @State private menuFocusRevision: number = 0;
  @State private desktopMenuOpen: boolean = false;
  private altPressedAlone: boolean = false;
  private focusRegion: number = -1;
  private navigationGestureActive: boolean = false;
  private navigationRefresh: NavigationRefreshController = new NavigationRefreshController(apiClient);
  private imagePreviewClosing: boolean = false;
  private desktopCommands: DesktopLogCommands = new DesktopLogCommands();
  private removeUnauthorizedHandler: () => void = () => {};
  private drafts: Map<string, PreservedLogDraft> = new Map();
  private captureDraft: () => Promise<PreservedLogDraft | undefined> = async () => undefined;
  private expiring: boolean = false;
  private draftStoreErrorShown: boolean = false;
  private preferencesReady: Promise<void> = Promise.resolve();
  private lastExitBackAt: number = 0;

  @State private sidebar: WorkspaceSidebarState = new WorkspaceSidebarState();
  @State private reading: WorkspaceReadingState = new WorkspaceReadingState();
  @State private readingTransition: ReadingTransitionCoordinator = new ReadingTransitionCoordinator();

  private moduleSwitchRevision: number = 0;
  private workspaceNavigationView?: WorkspaceNavigationView;
  @State private workspaceTransition: WorkspaceTransitionCoordinator = new WorkspaceTransitionCoordinator({
    tab: () => this.selectedModule,
    canCapture: (kind: string) => this.connected && this.isWide() &&
      (kind === 'module' || ((kind === 'document' || kind === 'mode') && this.selectedModule === 0 &&
        !!this.workspaceNavigationView?.hasLog())),
    capture: (kind: string) => this.getUIContext().getComponentSnapshot().get(
      kind === 'module' ? 'module_frame' : 'workspace_frame', { waitUntilRenderFinished: true }),
    fade: (update: () => void, finished: () => void) => {
      this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseOut, onFinish: finished }, update);
    }
  });

  private isWide(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE || this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private openNavigation(): void {
    const view = this.workspaceNavigationView;
    if (!view || this.isWide() || this.sidebar.navigationOpen ||
      (this.selectedModule === 0 && view.isLogOutlineOpen())) return;
    const revision = ++this.sidebar.navigationMotionRevision;
    this.sidebar.navigationClosing = false;
    this.sidebar.navigationOffset = -340;
    this.sidebar.navigationScrimOpacity = 0;
    this.sidebar.navigationOpen = true;
    this.getUIContext().getFocusController().clearFocus();
    revealPanel(this.getUIContext(), () => this.workspaceNavigationView === view && revision === this.sidebar.navigationMotionRevision &&
      this.sidebar.navigationOpen && !this.sidebar.navigationClosing, () => {
      this.sidebar.navigationOffset = 0;
      this.sidebar.navigationScrimOpacity = 1;
      this.getUIContext().getFocusController().requestFocus('navigation_drawer_close');
    });
  }

  private closeNavigation(): void {
    const view = this.workspaceNavigationView;
    if (!this.sidebar.navigationOpen || this.sidebar.navigationClosing) return;
    const revision = ++this.sidebar.navigationMotionRevision;
    this.sidebar.navigationClosing = true;
    this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseIn, onFinish: () => {
      if (this.workspaceNavigationView !== view || revision !== this.sidebar.navigationMotionRevision) return;
      this.sidebar.navigationOpen = false;
      this.sidebar.navigationClosing = false;
      if (!this.isWide()) this.getUIContext().getFocusController().requestFocus('workspace_navigation_open');
    } }, () => {
      this.sidebar.navigationOffset = -340;
      this.sidebar.navigationScrimOpacity = 0;
    });
  }

  private handleNavigationPanStart(event: GestureEvent): void {
    this.navigationGestureActive = false;
    if (!this.connected || this.isWide() || this.settingsOpen || this.aboutOpen || this.helpOpen ||
      this.previewImageSource || this.desktopMenuOpen || this.workspaceShortcutBlocked()) return;
    const pan = event as PanGestureEvent;
    const finger = pan.fingerList.length > 0 ? pan.fingerList[0] : undefined;
    const width = Number(pan.target.area.width);
    const startX = finger ? finger.localX - pan.offsetX : -1;
    this.navigationGestureActive = width > 0 && startX >= 16 && startX <= 144;
  }

  private handleNavigationPanEnd(event: GestureEvent): void {
    if (!this.navigationGestureActive) return;
    const pan = event as PanGestureEvent;
    const horizontalIntent = Math.abs(pan.offsetX) >= Math.abs(pan.offsetY) * 0.8;
    const shouldOpen = horizontalIntent && (pan.offsetX > 48 || pan.velocityX > 450);
    this.navigationGestureActive = false;
    if (shouldOpen) this.openNavigation();
  }

  private cancelNavigationPan(): void {
    this.navigationGestureActive = false;
  }

  private resetNavigationDrawer(): void {
    this.cancelNavigationPan();
    this.sidebar.navigationMotionRevision++;
    this.sidebar.navigationOpen = false;
    this.sidebar.navigationClosing = false;
    this.sidebar.navigationOffset = -340;
    this.sidebar.navigationScrimOpacity = 0;
  }

  private resetSidebarMotion(): void {
    this.sidebar.sidebarMotionRevision++;
    this.sidebar.sidebarAnimating = false;
  }

  private setDesktopNavigationCollapsed(collapsed: boolean, section: number = -1): void {
    const view = this.workspaceNavigationView;
    if (!view || !view.canMoveSidebar() || collapsed === this.sidebar.collapsedModules[this.selectedModule] || this.sidebar.sidebarAnimating ||
      this.workspaceTransition.task || this.workspaceTransition.snapshot) return;
    const revision = ++this.sidebar.sidebarMotionRevision;
    const origin = this.sidebar.collapsedModules[this.selectedModule] ? 0 : 1;
    const target = collapsed ? 0 : 1;
    this.sidebar.sidebarExpansion = origin;
    this.sidebar.sidebarAnimating = true;
    view.closeNavigation();
    const module = this.selectedModule;
    this.sidebar.collapsedModules = this.sidebar.collapsedModules.map((value: boolean, index: number) => index === module ? collapsed : value);
    workspacePreferences.set(`sidebarCollapsed${module}`, collapsed)
      .catch(() => appFeedback.show('侧栏状态保存失败', 'error'));
    const targetNavigationWidth = collapsed ? 52 :
      (this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220);
    const toolbarWidths: number[][] = module === 0 ? view.beginSidebarMotion(targetNavigationWidth) : [];
    const started = Date.now();
    const step = (): void => {
      if (revision !== this.sidebar.sidebarMotionRevision || this.workspaceNavigationView !== view) return;
      const progress = Math.min(1, (Date.now() - started) / 240);
      const eased = progress * progress * (3 - 2 * progress);
      this.sidebar.sidebarExpansion = origin + (target - origin) * eased;
      if (toolbarWidths.length) view.advanceSidebarMotion(toolbarWidths, eased);
      if (progress < 1) this.getUIContext().postFrameCallback(new FrameAction(step));
      else {
        this.sidebar.sidebarAnimating = false;
        this.getUIContext().postFrameCallback(new FrameAction(() => {
          if (revision === this.sidebar.sidebarMotionRevision && this.workspaceNavigationView === view) view.finishSidebarMotion();
        }));
        if (!collapsed && section >= 0) view.scrollSidebar(section);
      }
    };
    this.getUIContext().postFrameCallback(new FrameAction(step));
  }

  private resetReadingMode(): void {
    this.readingTransition.clear();
    this.reading.logsReadingMode = false;
    this.reading.readingProgress = 0;
  }

  private async setLogsReadingMode(active: boolean): Promise<void> {
    const view = this.workspaceNavigationView;
    if (!view || !this.isWide() || this.selectedModule !== 0 || !view.canRead(active) ||
      active === this.reading.logsReadingMode || this.readingTransition.animating ||
      this.workspaceTransition.task || this.workspaceTransition.snapshot) return;
    view.beforeReading();
    const revision = this.readingTransition.begin();
    if (this.reading.readingViewportWidth > 0) {
      try {
        const snapshot = await this.getUIContext().getComponentSnapshot().get('log_reading_surface',
          { waitUntilRenderFinished: true });
        if (revision !== this.readingTransition.revision) { snapshot.release(); return; }
        this.reading.readingCoverX = this.reading.readingViewportX;
        this.reading.readingCoverY = this.reading.readingViewportY;
        this.reading.readingCoverWidth = this.reading.readingImageWidth = this.reading.readingViewportWidth;
        this.reading.readingCoverHeight = this.reading.readingImageHeight = this.reading.readingViewportHeight;
        this.reading.readingImageInset = 0;
        await this.readingTransition.install(snapshot, revision);
      } catch (_) {
        // A failed capture must not block the mode change.
      }
    }
    if (revision !== this.readingTransition.revision) return;
    this.readingTransition.viewportReady = false;
    this.readingTransition.motionFinished = false;
    this.reading.logsReadingMode = active;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut, onFinish: () => {
      if (revision !== this.readingTransition.revision) return;
      this.readingTransition.motionFinished = true;
      this.reading.workspaceLayoutRevision++;
      this.readingTransition.finish();
    } }, () => this.reading.readingProgress = active ? 1 : 0);
  }

  private readingViewportChanged(area: Area): void {
    this.reading.readingViewportX = Number(area.globalPosition.x) - this.reading.workspaceOriginX;
    this.reading.readingViewportY = Number(area.globalPosition.y) - this.reading.workspaceOriginY;
    this.reading.readingViewportWidth = Number(area.width);
    this.reading.readingViewportHeight = Number(area.height);
    if (!this.readingTransition.snapshot || !this.readingTransition.animating) return;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut }, () => {
      this.reading.readingCoverX = this.reading.readingViewportX;
      this.reading.readingCoverY = this.reading.readingViewportY;
      this.reading.readingCoverWidth = this.reading.readingViewportWidth;
      this.reading.readingCoverHeight = this.reading.readingViewportHeight;
      this.reading.readingImageInset = Math.max(0, (this.reading.readingViewportWidth - READING_MAX_WIDTH) / 2) -
        Math.max(0, (this.reading.readingImageWidth - READING_MAX_WIDTH) / 2);
    });
  }

  private readingViewportReady(): void {
    if (!this.readingTransition.animating) return;
    this.readingTransition.viewportReady = true;
    this.readingTransition.finish();
  }

  private clearModuleNavigation(): void {
    this.navigationMonthsExpanded = false;
    this.navigationDayQuery = '';
    this.newLogDate = '';
    this.calendarMode = 'create';
    this.calendarOpen = false;
    this.railPopover = '';
    this.moduleFrameHeight = 0;
    this.searchFocusRevision = 0;
    this.topMoreOpen = false;
    this.desktopThemeOpen = false;
    this.desktopKeyboardFocus = false;
    this.compactSettingsOpen = false;

    this.resetNavigationDrawer();
    this.resetSidebarMotion();
    this.resetReadingMode();
    this.workspaceNavigationView = undefined;
    this.moduleSwitchRevision++;
    this.modules.pendingLogDate = '';
    this.modules.moduleRequestedTab = -1;
    this.modules.outgoingTab = -1;
    this.modules.moduleReveal = 1;
    this.workspaceTransition.clear();
  }

  private registerWorkspaceNavigation(view: WorkspaceNavigationView): WorkspaceNavigationCommands {
    if (this.workspaceNavigationView) this.clearModuleNavigation();
    this.workspaceNavigationView = view;
    this.sidebar.collapsedModules = [0, 1, 2, 3, 4].map((index: number) =>
      AppStorage.get<boolean>(`pref_sidebarCollapsed${index}`) || false);
    const active = (): boolean => this.workspaceNavigationView === view;
    const commands = new WorkspaceNavigationCommands();
    commands.request = (index: number, discardNotes: boolean, discardQa: boolean, afterSwitch: () => void, targetDate: string): void => {
      if (active()) this.requestModule(index, discardNotes, discardQa, afterSwitch, targetDate);
    };
    commands.openSearch = (): void => { if (active()) this.openCurrentSearch(); };
    commands.settings = (): void => { if (active()) this.settingsOpen = true; };
    commands.about = (): void => { if (active()) this.aboutOpen = true; };
    commands.help = (): void => { if (active()) this.openHelp(); };
    commands.theme = (value: string): void => { if (active()) this.setTheme(value); };
    commands.changeServer = (): void => {
      if (!active()) return;
      this.confirmQaLeave(() => this.confirmNotesLeave(() => view.confirmLogLeave(() => {
        if (!active()) return;
        if (this.modules.taxonomyOpen) this.confirmTaxonomyLeave(() => { if (active()) this.changeServer(); });
        else this.changeServer();
      })));
    };
    commands.refreshNavigation = async (): Promise<void> => { if (active()) await this.refreshNavigationLists(); };
    commands.searchResult = (result: LogSearchResult): void => { if (active()) this.selectSearchResult(result); };
    commands.citation = (date: string, heading: string, index: number): void => { if (active()) this.openQaCitation(date, heading, index); };
    commands.noteLink = (date: string, heading: string): void => { if (active()) this.openNoteLink(date, heading); };
    commands.favorite = (favorite: FavoriteHeading): void => { if (active()) this.openFavorite(favorite); };
    commands.statsEntry = (entry: StatsEntry): void => { if (active()) this.openStatsEntry(entry); };
    commands.notesLeave = (action: () => void): void => { if (active()) this.confirmNotesLeave(action); };
    commands.qaLeave = (action: () => void): void => { if (active()) this.confirmQaLeave(action); };
    commands.taxonomyLeave = (action: () => void): void => { if (active()) this.confirmTaxonomyLeave(action); };
    commands.openTaxonomy = (): void => { if (active()) this.openTaxonomy(); };
    commands.qaSession = (id: string, focus: boolean): void => { if (active()) this.switchQaSession(id, focus); };
    commands.qaDelete = (session: RagSessionSummary): void => { if (active()) this.confirmQaDelete(session); };
    commands.ready = (date: string): void => { if (active()) this.logDocumentReady(date); };
    commands.failed = (date: string): void => { if (active()) this.logNavigationFailed(date); };
    commands.readingMode = async (value: boolean): Promise<void> => { if (active()) await this.setLogsReadingMode(value); };
    commands.readingViewport = (area: Area): void => { if (active()) this.readingViewportChanged(area); };
    commands.readingReady = (): void => { if (active()) this.readingViewportReady(); };
    commands.readingOrigin = (area: Area): void => {
      if (!active()) return;
      this.reading.workspaceOriginX = Number(area.globalPosition.x);
      this.reading.workspaceOriginY = Number(area.globalPosition.y);
    };
    commands.navigation = (open: boolean): void => { if (active()) { if (open) this.openNavigation(); else this.closeNavigation(); } };
    commands.sidebarCollapsed = (collapsed: boolean, section: number): void => { if (active()) this.setDesktopNavigationCollapsed(collapsed, section); };
    commands.editorCommand = (command: string): void => { if (active()) this.editorWorkspaceCommand(command); };
    commands.focusRegion = (reverse: boolean): void => { if (active()) this.focusWorkspaceRegion(reverse); };
    commands.dispose = (): void => { if (active()) this.clearModuleNavigation(); };
    this.workspaceCommands = commands;
    return commands;
  }

  private openCurrentSearch(): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.selectedModule === 0) {
      this.search.changeLogSearchQuery('');
      this.searchOpen = true;
      setTimeout(() => {
        if (this.workspaceNavigationView === view && this.selectedModule === 0 && this.searchOpen) this.searchFocusRevision++;
      }, 40);
    } else if (this.selectedModule === 1) {
      this.modules.noteSearchRevision++;
    } else if (this.selectedModule === 2) {
      this.modules.favoritesSearchRevision++;
    } else if (this.selectedModule === 3) {
      if (this.isWide()) {
        const collapsed = this.sidebar.collapsedModules[3];
        if (collapsed) this.setDesktopNavigationCollapsed(false);
        setTimeout(() => {
          if (this.workspaceNavigationView === view && this.selectedModule === 3 &&
            !this.sidebar.collapsedModules[3] && !this.sidebar.sidebarAnimating) this.modules.qaSearchRevision++;
        }, collapsed ? 260 : 0);
      } else {
        this.openNavigation();
        setTimeout(() => {
          if (this.workspaceNavigationView === view && this.selectedModule === 3 &&
            this.sidebar.navigationOpen && !this.sidebar.navigationClosing) this.modules.qaSearchRevision++;
        }, 240);
      }
    }
  }

  private async refreshNavigationLists(): Promise<void> {
    const view = this.workspaceNavigationView;
    if (!view) return;
    const tab = this.selectedModule;
    const instance = activeInstance.revision;
    const month = this.logNavigation.month || view.currentLogDate().slice(0, 7);
    const date = view.currentLogDate();
    const months = this.logNavigation.months;
    const days = this.logNavigation.days;
    const years = this.modules.noteYears;
    const qa = this.qaNavigation.qaSessions;
    const stats = this.modules.statsMonths;
    const favorites = this.favoritesData.favorites;
    const groups = this.favoritesData.groups;
    await this.navigationRefresh.refresh(tab, month, () => {
      if (instance !== activeInstance.revision || this.workspaceNavigationView !== view || this.selectedModule !== tab) return false;
      if (tab === 0) return date === view.currentLogDate() && month === (this.logNavigation.month || view.currentLogDate().slice(0, 7)) &&
        !this.logNavigation.monthsLoading;
      if (tab === 1) return years === this.modules.noteYears;
      if (tab === 2) return favorites === this.favoritesData.favorites && groups === this.favoritesData.groups &&
        !this.favoritesData.loading && !this.favoritesData.groupSaving && !this.favoritesData.groupUpdating &&
        !this.favoritesData.groupActionBusy;
      if (tab === 3) return qa === this.qaNavigation.qaSessions && !this.qaNavigation.qaNavigationLoading;
      return stats === this.modules.statsMonths;
    }, (snapshot: NavigationSnapshot) => {
      if (tab === 0 && snapshot.months) {
        const updateMonths = months === this.logNavigation.months;
        const updateDays = !!snapshot.days && days === this.logNavigation.days && !this.logNavigation.daysLoading;
        if (updateMonths) this.logNavigation.months = snapshot.months.months;
        if (updateDays && snapshot.days) {
          this.logNavigation.days = snapshot.days.days;
        }
        if (updateMonths || updateDays) this.logNavigation.navigationError = '';
      }
      if (snapshot.notes) {
        this.modules.noteYears = snapshot.notes.years;
        this.modules.noteTags = snapshot.notes.tags;
        this.modules.noteCount = snapshot.notes.notes.length;
      }
      if (snapshot.favorites) {
        this.favoritesData.favorites = snapshot.favorites.favorites;
        this.favoritesData.groups = snapshot.favorites.groups;
        this.favoritesData.loadFailed = false;
        this.favoritesData.errorMessage = '';
      }
      if (snapshot.qa) this.qaNavigation.acceptQaNavigation(snapshot.qa.sessions);
      if (tab === 4 && snapshot.months) {
        this.modules.statsMonths = snapshot.months.months;
        this.modules.statsMonthsError = '';
      }
    });
  }

  private selectSearchResult(result: LogSearchResult): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return;
    const view = this.workspaceNavigationView;
    if (!view) return;
    const query = this.search.searchQuery.trim();
    const heading = (result.matches[0] || '').replace(/^#{1,6}\s+/, '').replace(/^\d+\.\s+/, '').trim();
    const navigate = (): void => {
      if (this.workspaceNavigationView !== view) return;
      this.searchOpen = false;
      this.search.dismissSearchResults();
      view.openLogSource({ date: result.date, heading: result.headings.includes(heading) ? heading : '',
        headingIndex: -1, headingId: '', kind: 'search', query: query });
    };
    if (this.selectedModule !== 0) this.requestModule(0, false, false, navigate, result.date);
    else if (result.date === view.currentLogDate()) navigate();
    else view.confirmLogLeave(navigate);
  }

  private openLogSource(target: LogSourceTarget): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    this.requestModule(0, false, false, () => {
      if (this.workspaceNavigationView === view) view.openLogSource(target);
    }, target.date);
  }

  private openStatsEntry(entry: StatsEntry): void {
    this.openLogSource({ date: entry.date, heading: entry.rawHeading, headingIndex: entry.headingIndex,
      headingId: '', kind: 'stats' });
  }

  private openQaCitation(date: string, heading: string, headingIndex: number): void {
    this.openLogSource({ date: date, heading: heading, headingIndex: headingIndex, headingId: '', kind: 'citation' });
  }

  private openNoteLink(date: string, heading: string): void {
    this.openLogSource({ date: date, heading: heading, headingIndex: -1, headingId: heading, kind: 'internal' });
  }

  private openFavorite(favorite: FavoriteHeading): void {
    this.openLogSource({ date: favorite.date, heading: favorite.exists ? favorite.headingText : '', headingIndex: -1,
      headingId: favorite.exists ? (favorite.resolvedHeadingId || favorite.headingId) : `missing-${favorite.id}`,
      kind: 'favorite' });
  }

  private requestModule(index: number, discardNotes: boolean = false, discardQa: boolean = false,
    afterSwitch: () => void = () => {}, targetDate: string = ''): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (index === this.selectedModule && this.modules.moduleRequestedTab < 0) {
      if (this.modules.pendingLogDate) {
        this.modules.pendingLogDate = targetDate && !view.isDocumentReady(targetDate) ? targetDate : '';
        if (!this.modules.pendingLogDate) this.revealModule(this.moduleSwitchRevision);
      }
      afterSwitch(); return;
    }
    if (this.modules.taxonomyOpen) {
      this.confirmTaxonomyLeave(() => { if (this.workspaceNavigationView === view) this.requestModule(index, discardNotes, discardQa, afterSwitch, targetDate); }); return;
    }
    if ((this.selectedModule === 1)) {
      if (this.modules.notesBusy) return;
      if (this.modules.notesDirty && !discardNotes) {
        AlertDialog.show({ message: '随记尚未保存，确定放弃修改吗？',
          primaryButton: { value: '继续编辑', action: () => {} },
          secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
            if (this.workspaceNavigationView === view) this.requestModule(index, true, discardQa, afterSwitch, targetDate);
          } } });
        return;
      }
    }
    if ((this.selectedModule === 3)) {
      if (this.modules.qaBusy) { appFeedback.show('请先停止当前回答', 'error'); return; }
      if ((this.modules.qaDirty || this.modules.qaPending) && !discardQa) {
        AlertDialog.show({ message: this.modules.qaPending ? '当前问答尚未保存，确定放弃吗？' :
          '问答输入尚未提交，确定放弃吗？',
          primaryButton: { value: '继续编辑', action: () => {} },
          secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: () => {
            if (this.workspaceNavigationView === view) this.requestModule(index, discardNotes, true, afterSwitch, targetDate);
          } } });
        return;
      }
    }
    const change = (): void => { if (this.workspaceNavigationView !== view) return; this.switchModule(index, discardNotes, discardQa, afterSwitch, targetDate); };
    if (index === 0) change();
    else view.confirmLogLeave(change);
  }

  private async switchModule(index: number, discardNotes: boolean, discardQa: boolean,
    afterSwitch: () => void = () => {}, targetDate: string = ''): Promise<void> {
    const view = this.workspaceNavigationView;
    if (!view) return;
    this.getUIContext().getFocusController().clearFocus();
    const revision = ++this.moduleSwitchRevision;
    this.modules.moduleRequestedTab = index;
    if (this.isWide() && !view.isReading()) {
      this.workspaceTransition.clear();
      await this.workspaceTransition.cover('module');
      if (revision !== this.moduleSwitchRevision || this.workspaceNavigationView !== view) return;
    }
    const covered = this.workspaceTransition.snapshot && this.workspaceTransition.kind === 'module';
    this.modules.outgoingTab = covered ? -1 : this.selectedModule;
    this.modules.moduleReveal = covered ? 1 : 0;
    this.modules.pendingLogDate = index === 0 && targetDate && !view.isDocumentReady(targetDate) ? targetDate : '';
    if (discardNotes) { this.modules.notesDirty = false; this.modules.noteDiscardRevision++; }
    if (discardQa) { this.modules.qaDirty = false; this.modules.qaPending = false; this.modules.qaDiscardRevision++; }
    if (index !== 0) { this.resetReadingMode(); view.leaveLog(); }
    this.resetSidebarMotion();
    this.selectedModule = index;
    this.modules.moduleRequestedTab = -1;
    view.changed(index);
    if (index === 1) this.modules.notesRefreshRevision += 1;
    if (index === 2) this.modules.favoritesRefreshRevision += 1;
    if (index === 3) this.qaNavigation.loadQaNavigation();
    if (index === 4) this.modules.statsVisitRevision += 1;
    if (index === 0) this.refreshNavigationLists().catch(() => {
      if (this.selectedModule === 0 && this.workspaceNavigationView === view) {
        appFeedback.show('导航刷新失败，已保留原列表，请下拉重试', 'error', 3600, 'navigation-refresh');
      }
    });
    afterSwitch();
    if (!this.modules.pendingLogDate) this.revealModule(revision);
  }

  private revealModule(revision: number): void {
    this.getUIContext().postFrameCallback(new FrameAction(() => {
      if (revision !== this.moduleSwitchRevision || this.modules.pendingLogDate) return;
      if (this.workspaceTransition.kind === 'module') {
        this.workspaceTransition.finish('module');
      } else {
        this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseOut, onFinish: () => {
          if (revision === this.moduleSwitchRevision) this.modules.outgoingTab = -1;
        } }, () => this.modules.moduleReveal = 1);
      }
    }));
  }

  private logDocumentReady(date: string): void {
    if (this.connected) this.launchReady = true;
    if (this.selectedModule !== 0 || !this.modules.pendingLogDate || date !== this.modules.pendingLogDate) return;
    this.modules.pendingLogDate = '';
    this.revealModule(this.moduleSwitchRevision);
  }

  private logNavigationFailed(date: string): void {
    this.logDocumentReady(date);
  }

  private confirmTaxonomyLeave(action: () => void): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.modules.taxonomyBusy) { appFeedback.show('分类操作正在进行，请稍候'); return; }
    const leave = (): void => {
      if (this.workspaceNavigationView !== view) return;
      try { taxonomyDraftStore.clear(activeInstance.namespace); }
      catch (_) { appFeedback.show('本机分类草稿清理失败', 'error'); }
      this.modules.taxonomyDirty = false; this.modules.taxonomyOpen = false; action();
    };
    if (!this.modules.taxonomyDirty) { leave(); return; }
    AlertDialog.show({ message: '当前分类修改或建议尚未处理，确定放弃吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: leave } });
  }

  private confirmNotesLeave(action: () => void): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.modules.notesBusy) return;
    if (!this.modules.notesDirty) { action(); return; }
    AlertDialog.show({ message: '随记尚未保存，确定放弃修改吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        if (this.workspaceNavigationView !== view) return;
        this.modules.notesDirty = false;
        this.modules.noteDiscardRevision++;
        action();
      } } });
  }

  private confirmQaLeave(action: () => void): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.modules.qaBusy) { appFeedback.show('请先停止当前回答', 'error'); return; }
    if (!this.modules.qaDirty && !this.modules.qaPending) { action(); return; }
    AlertDialog.show({ message: this.modules.qaPending ? '当前问答尚未保存，确定放弃吗？' : '问答输入尚未提交，确定放弃吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: () => {
        if (this.workspaceNavigationView !== view) return;
        this.modules.qaDirty = false; this.modules.qaPending = false; this.modules.qaDiscardRevision++; action();
      } } });
  }

  private openTaxonomy(): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    view.closeNavigation();
    this.modules.taxonomyOpen = true;
  }

  private switchQaSession(id: string, focusQuestion: boolean = false): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.modules.qaBusy) return;
    const change = (): void => {
      if (this.workspaceNavigationView !== view) return;
      this.modules.qaDirty = false; this.modules.qaPending = false;
      view.closeNavigation();
      this.modules.qaSessionId = id; this.modules.qaRequestRevision++;
      if (focusQuestion) setTimeout(() => {
        if (this.workspaceNavigationView === view && this.selectedModule === 3 && !this.modules.qaBusy) this.modules.qaQuestionFocusRevision++;
      }, 40);
    };
    if (!this.modules.qaDirty && !this.modules.qaPending) { change(); return; }
    AlertDialog.show({ message: this.modules.qaPending ? '当前问答尚未保存，确定切换会话吗？' : '问答输入尚未提交，确定切换会话吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: change } });
  }

  private confirmQaDelete(session: RagSessionSummary): void {
    const view = this.workspaceNavigationView;
    if (!view) return;
    if (this.modules.qaBusy) return;
    if (session.id === this.modules.qaSessionId && (this.modules.qaDirty || this.modules.qaPending)) {
      appFeedback.show('请先处理当前未保存的问答', 'error'); return;
    }
    AlertDialog.show({ message: `确认删除问答“${session.title}”吗？`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'),
        action: () => { if (this.workspaceNavigationView === view) this.qaNavigation.deleteQaSession(session.id); } } });
  }

  private createQaNavigation(): QaNavigationController {
    const modules = this.modules;
    return new QaNavigationController(apiClient, {
      active: () => this.connected && this.selectedModule === 3 && this.modules === modules,
      busy: () => modules.qaBusy,
      setBusy: (value: boolean) => modules.qaBusy = value,
      activeSession: () => modules.qaSessionId,
      clearSession: () => { modules.qaSessionId = ''; modules.qaRequestRevision++; }
    });
  }

  private createWorkspaceSearch(): WorkspaceSearchController {
    const modules = this.modules;
    return new WorkspaceSearchController(new LogSearchRepository(apiClient), {
      context: () => this.getUIContext().getHostContext() as common.UIAbilityContext,
      lifecycle: () => activeInstance.revision,
      namespace: () => activeInstance.namespace,
      active: () => this.connected && this.modules === modules,
      open: () => this.searchOpen,
      remember: () => this.rememberSearch,
      reveal: () => this.searchOpen = true
    });
  }

  private invalidateModules(): void {
    this.clearModuleNavigation();
    this.search.dispose();
    this.logNavigation.dispose();
    this.searchOpen = false;
    this.favoritesData.dispose();
    this.qaNavigation.qaNavigationRevision++;
    this.qaNavigation.qaMutationRevision++;
    this.modules.qaBusy = false;
    this.qaNavigation.qaNavigationLoading = false;
  }

  private resetModules(): void {
    this.invalidateModules();
    this.modules = new WorkspaceModuleState();
    this.favoritesData = new FavoritesController(apiClient);
    this.qaNavigation = this.createQaNavigation();
    this.search = this.createWorkspaceSearch();
    this.logNavigation = new LogNavigationController();
    this.logSession = new LogSession();
    this.logLoadingHint = new LoadingHintPlacement();
    this.selectedModule = 0;
  }

  aboutToAppear(): void {
    // Keyboard avoidance belongs to the window, not individual input focus lifetimes.
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.registerFonts();
    appFeedback.attach(this.getUIContext(), () => this.connected && !this.isWide() &&
      !this.modules.taxonomyOpen && !this.searchOpen);
    this.preferencesReady = workspacePreferences.initialize(this.getUIContext().getHostContext() as common.UIAbilityContext);
    this.removeUnauthorizedHandler = apiClient.setUnauthorizedHandler(() => { this.expireSession(); });
  }

  aboutToDisappear(): void { this.invalidateModules(); this.removeUnauthorizedHandler(); appFeedback.detach(); }

  private async expireSession(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    try {
      const draft = await this.captureDraft();
      if (draft) this.recordDraft(draft.namespace, draft);
    } catch (_) { /* Retain the last editor change already recorded. */ }
    apiClient.setToken('');
    this.restoreOnAppear = false;
    await TokenStore.clear().catch(() => {});
    this.invalidateModules();
    this.connected = false;
    this.expiring = false;
  }

  private recordDraft(namespace: string, draft: PreservedLogDraft | undefined): void {
    if (!namespace || namespace !== activeInstance.namespace) return;
    if (draft) this.drafts.set(namespace, draft);
    else this.drafts.delete(namespace);
    try {
      if (draft) logDraftStore.save(draft);
      else logDraftStore.clear(namespace);
      this.draftStoreErrorShown = false;
    } catch (_) {
      if (!this.draftStoreErrorShown) {
        this.draftStoreErrorShown = true;
        appFeedback.show('本机草稿暂存失败，请及时复制或保存当前内容', 'error');
      }
    }
  }

  private registerFonts(): void {
    const fonts = this.getUIContext().getFont();
    fonts.registerFont({ familyName: 'StudyLogSerif',
      familySrc: 'file:///system/fonts/NotoSerifCJK-Regular.ttc' });
    fonts.registerFont({ familyName: 'StudyLogSlogan',
      familySrc: $rawfile('fonts/study_log_serif_slogan.otf') });
    fonts.registerFont({ familyName: 'StudyLogDate',
      familySrc: $rawfile('fonts/noto_serif_sc_bold_date.otf') });
    fonts.registerFont({ familyName: 'StudyLogMono',
      familySrc: $rawfile('fonts/jetbrains_mono_variable.ttf') });
    fonts.registerFont({ familyName: 'StudyLogDesktopLatinSerif',
      familySrc: $rawfile('fonts/gelasio_variable.ttf') });
    fonts.registerFont({ familyName: 'StudyLogPaperMono',
      familySrc: $rawfile('fonts/paper_mono_variable.ttf') });
    let serif = '/system/fonts/NotoSerifCJK-Regular.ttc';
    try { fileIo.statSync('/system/fonts/FZShuS-SC.ttf'); serif = '/system/fonts/FZShuS-SC.ttf'; }
    catch (_) { /* Use the system serif fallback. */ }
    fonts.registerFont({ familyName: 'StudyLogDesktopSerif', familySrc: `file://${serif}` });
    try {
      fileIo.statSync('/system/fonts/NotoSansMono[wdth,wght].ttf');
      fonts.registerFont({ familyName: 'StudyLogDesktopCode',
        familySrc: 'file:///system/fonts/NotoSansMono[wdth,wght].ttf' });
    } catch (_) {
      fonts.registerFont({ familyName: 'StudyLogDesktopCode',
        familySrc: $rawfile('fonts/jetbrains_mono_variable.ttf') });
    }
  }

  private async connectedTo(_origin: string, _capabilities: InstanceCapabilities): Promise<void> {
    const revision = activeInstance.revision;
    const namespace = activeInstance.namespace;
    await this.preferencesReady;
    if (revision !== activeInstance.revision) return;
    try {
      await logDraftStore.initialize(this.getUIContext().getHostContext() as common.Context);
      if (revision !== activeInstance.revision) return;
      await noteDraftStore.initialize(this.getUIContext().getHostContext() as common.Context);
      if (revision !== activeInstance.revision) return;
      await taxonomyDraftStore.initialize(this.getUIContext().getHostContext() as common.Context);
      if (revision !== activeInstance.revision) return;
      const draft = logDraftStore.load(namespace);
      if (draft) this.drafts.set(namespace, draft);
      else this.drafts.delete(namespace);
    } catch (_) {
      appFeedback.show('本机草稿读取失败，请检查设备存储', 'error');
    }
    if (revision !== activeInstance.revision) return;
    this.resetModules();
    this.connected = true;
    this.search.restoreSearchHistory();
    this.favoritesData.load();
  }

  private changeServer(): void {
    apiClient.setToken('');
    activeInstance.activate('', '');
    this.restoreOnAppear = false;
    this.invalidateModules();
    this.connected = false;
  }

  private updateBreakpoint(width: number): void {
    const wasWide = this.isWide();
    this.workspaceBreakpoint = width < 600 ? WorkspaceBreakpoint.COMPACT :
      width < 840 ? WorkspaceBreakpoint.MEDIUM :
        width < 1440 ? WorkspaceBreakpoint.LARGE : WorkspaceBreakpoint.EXTRA_LARGE;
    if (wasWide && !this.isWide()) this.resetReadingMode();
  }

  private async setTheme(value: string): Promise<void> {
    if (value !== 'system' && value !== 'light' && value !== 'dark') return;
    this.themePreference = value;
    const mode = value === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT :
      value === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK :
        ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
    (this.getUIContext().getHostContext() as common.UIAbilityContext).getApplicationContext().setColorMode(mode);
    try {
      const store = await preferences.getPreferences(this.getUIContext().getHostContext() as common.UIAbilityContext,
        { name: THEME_PREFERENCES });
      await store.put('theme', value);
      await store.flush();
    } catch (_) { /* The selected theme remains active until the app closes. */ }
  }

  private windowMenuEntries(menu: string): DesktopMenuEntry[] {
    const available = this.connected && !this.previewImageSource && !this.settingsOpen &&
      !this.aboutOpen && !this.helpOpen;
    if (menu === '帮助') return [
      new DesktopMenuEntry('help', '使用说明与快捷键', available, false, 'F1'),
      new DesktopMenuEntry('about', '关于学习日志工作台', available)
    ];
    const entries = this.desktopCommands.entries(menu);
    const items = entries.map((entry: DesktopMenuEntry) => new DesktopMenuEntry(entry.id, entry.label,
      available && entry.enabled, available && entry.checked, entry.shortcut));
    if (menu === '编辑') items.push(new DesktopMenuEntry('settings', '设置', available));
    if (menu === '视图') items.push(
      new DesktopMenuEntry('theme_light', '浅色模式', available, this.themePreference === 'light'),
      new DesktopMenuEntry('theme_dark', '深色模式', available, this.themePreference === 'dark'),
      new DesktopMenuEntry('theme_system', '跟随系统', available, this.themePreference === 'system'));
    return items;
  }

  private executeWindowMenu(id: string): void {
    const enabled = ['文件', '编辑', '视图', '帮助'].flatMap((menu: string) => this.windowMenuEntries(menu))
      .some((entry: DesktopMenuEntry) => entry.id === id && entry.enabled);
    if (enabled && id.startsWith('theme_')) this.setTheme(id.slice(6));
    else if (enabled && id === 'settings') this.settingsOpen = true;
    else if (enabled && id === 'about') this.aboutOpen = true;
    else if (enabled && id === 'help') this.openHelp();
    else if (enabled) this.desktopCommands.execute(id);
  }

  private revealImagePreview(): void {
    if (this.imagePreviewClosing || this.imagePreviewOpacity > 0) return;
    this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseOut }, () => this.imagePreviewOpacity = 1);
  }

  private closeImagePreview(): void {
    if (this.imagePreviewClosing || !this.previewImageSource) return;
    this.imagePreviewClosing = true;
    this.getUIContext().animateTo({ duration: 140, curve: Curve.EaseIn, onFinish: () => {
      this.previewImageSource = '';
      this.imagePreviewClosing = false;
    } }, () => this.imagePreviewOpacity = 0);
  }

  private openHelp(): void {
    this.helpOpen = true;
    setTimeout(() => {
      if (this.helpOpen && !this.aboutOpen && !this.settingsOpen) focusControl.requestFocus('help_close_button');
    }, 20);
  }

  private focusWorkspaceRegion(reverse: boolean): void {
    if (!this.connected || !this.isWide() || this.settingsOpen || this.aboutOpen || this.helpOpen ||
      this.previewImageSource || this.desktopMenuOpen || this.workspaceShortcutBlocked()) return;
    const regions = this.reading.logsReadingMode ? ['module_frame'] : ['global_log_search',
      this.sidebar.collapsedModules[this.selectedModule] ? 'sidebar_rail_expand' : 'sidebar_collapse', 'module_frame'];
    for (let index = 0; index < regions.length; index++) {
      this.focusRegion = (this.focusRegion + (reverse ? -1 : 1) + regions.length) % regions.length;
      if (focusControl.requestFocus(regions[this.focusRegion])) break;
    }
  }

  private editorWorkspaceCommand(command: string): void {
    const view = this.workspaceNavigationView;
    if (!this.connected || !view || this.settingsOpen || this.aboutOpen || this.helpOpen ||
      this.previewImageSource || this.desktopMenuOpen || this.workspaceShortcutBlocked()) return;
    if (command === 'help') this.openHelp();
    else if (command === 'focusNext' || command === 'focusPrevious') this.focusWorkspaceRegion(command === 'focusPrevious');
    else if (command === 'menuFocus' && this.desktopWindowChrome) this.menuFocusRevision++;
    else if (command === 'newLog') this.requestModule(0, false, false, () => {
      if (this.workspaceNavigationView === view) view.openLogDatePicker('create');
    });
    else if (command === 'newQa' && !this.modules.qaBusy) this.requestModule(3, false, false, () => {
      if (this.workspaceNavigationView === view) this.switchQaSession('', true);
    });
  }

  private workspaceShortcutBlocked(): boolean {
    return this.desktopCommands.blocked() || this.modules.taxonomyOpen || this.desktopThemeOpen || this.topMoreOpen ||
      this.compactSettingsOpen || this.calendarOpen || !!this.railPopover || (!this.isWide() && this.searchOpen) ||
      this.sidebar.navigationOpen || !!this.qaNavigation.qaRenameId || !!this.qaNavigation.qaMenuId;
  }

  private dismissTopLayer(): boolean {
    if (this.settingsOpen) { this.settingsOpen = false; return true; }
    if (this.aboutOpen) { this.aboutOpen = false; return true; }
    if (this.helpOpen) { this.helpOpen = false; return true; }
    if (this.previewImageSource) { this.closeImagePreview(); return true; }
    if (this.desktopThemeOpen) { this.desktopThemeOpen = false; return true; }
    if (this.topMoreOpen) { this.topMoreOpen = false; return true; }
    if (this.compactSettingsOpen) { this.compactSettingsOpen = false; return true; }
    if (this.desktopCommands.closeMenu()) return true;
    if (this.calendarOpen) { this.calendarOpen = false; return true; }
    if (this.railPopover) { this.railPopover = ''; return true; }
    if (this.qaNavigation.qaRenameId) { this.qaNavigation.qaRenameId = ''; return true; }
    if (this.qaNavigation.qaMenuId) { this.qaNavigation.qaMenuId = ''; return true; }
    if (this.desktopCommands.closeOutline()) return true;
    if (this.searchOpen) { this.searchOpen = false; this.search.dismissSearchResults(); return true; }
    if (this.sidebar.navigationOpen) { this.closeNavigation(); return true; }
    if (this.modules.taxonomyOpen) { this.confirmTaxonomyLeave(() => {}); return true; }
    if (this.reading.logsReadingMode) { this.setLogsReadingMode(false); return true; }
    return false;
  }

  onBackPress(): boolean {
    if (this.dismissTopLayer()) { this.lastExitBackAt = 0; return true; }
    const now = Date.now();
    if (now - this.lastExitBackAt <= 2000) {
      this.lastExitBackAt = 0;
      (this.getUIContext().getHostContext() as common.UIAbilityContext).terminateSelf((error) => {
        if (error) appFeedback.show('退出应用失败', 'error');
      });
      return true;
    }
    this.lastExitBackAt = now;
    appFeedback.show('再返回一次退出应用', 'info', 2000);
    return true;
  }

  private handleWorkspaceKey(event: KeyEvent): boolean {
    if (this.settingsOpen || this.aboutOpen || this.helpOpen || this.previewImageSource) {
      if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) this.dismissTopLayer();
      return true;
    }
    if (event.keyCode === KeyCode.KEYCODE_ALT_LEFT || event.keyCode === KeyCode.KEYCODE_ALT_RIGHT) {
      if (event.type === KeyType.Down) this.altPressedAlone = true;
      else if (this.altPressedAlone && this.desktopWindowChrome && this.connected && !this.desktopMenuOpen &&
        !this.workspaceShortcutBlocked()) {
        this.altPressedAlone = false;
        this.menuFocusRevision++;
        return true;
      }
      return false;
    }
    if (event.type !== KeyType.Down) return false;
    this.altPressedAlone = false;
    if (!this.connected || this.desktopMenuOpen) return false;
    this.desktopKeyboardFocus = true;
    if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) {
      return this.dismissTopLayer();
    }
    if (this.workspaceShortcutBlocked()) return false;
    if (workspaceKey(event, KeyCode.KEYCODE_F6) || workspaceKey(event, KeyCode.KEYCODE_F6, false, true)) {
      if (!this.isWide()) return false;
      this.focusWorkspaceRegion(!!event.getModifierKeyState?.(['Shift']));
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_F, true, true)) {
      this.openCurrentSearch();
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_UP, false, false, true) && this.selectedModule !== 0) {
      const requests = this.modules.topRequests.slice();
      requests[this.selectedModule]++;
      this.modules.topRequests = requests;
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_G, true)) {
      if (this.selectedModule === 0 && this.desktopCommands.editorFocused()) return false;
      const view = this.workspaceNavigationView;
      if (!view) return false;
      this.requestModule(0, false, false, () => {
        if (this.workspaceNavigationView === view) view.openLogDatePicker('jump');
      });
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_N, true, false, true)) {
      this.editorWorkspaceCommand('newLog');
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_Q, true, false, true)) {
      if (this.modules.qaBusy) return false;
      this.editorWorkspaceCommand('newQa');
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_S, true) && this.selectedModule !== 0) {
      if (this.selectedModule === 1) this.modules.noteSaveRevision++;
      return true;
    }
    if (this.selectedModule === 0 && this.desktopCommands.handleKey(event)) return true;
    if (workspaceKey(event, KeyCode.KEYCODE_F1)) { this.openHelp(); return true; }
    if (workspaceKey(event, KeyCode.KEYCODE_F10) && this.desktopWindowChrome) {
      this.menuFocusRevision++;
      return true;
    }
    return false;
  }

  private desktopNavigationWidth(): number {
    const full = this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220;
    return 52 + (full - 52) * (this.sidebar.sidebarAnimating ? this.sidebar.sidebarExpansion :
      (this.sidebar.collapsedModules[this.selectedModule] ? 0 : 1));
  }



  private calendarDate(value: Date): string {
    return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
  }

  @Builder
  private logContent() {
        LogsReaderPage({ session: this.logSession, logLoadingHint: $logLoadingHint,
          onWorkspaceKey: (event: KeyEvent) => this.handleWorkspaceKey(event),
          newLogDate: $newLogDate, calendarMode: $calendarMode, calendarOpen: $calendarOpen,
          logNavigationScroller: this.logNavigationScroller, railPopover: $railPopover, searchFocusRevision: $searchFocusRevision, topMoreOpen: $topMoreOpen, desktopThemeOpen: $desktopThemeOpen, desktopKeyboardFocus: $desktopKeyboardFocus, compactSettingsOpen: $compactSettingsOpen,
          selectedModule: $selectedModule, modules: this.modules, desktopWindowChrome: this.desktopWindowChrome,
          workspaceTransition: this.workspaceTransition, reading: this.reading, sidebar: this.sidebar,
          onRegisterNavigation: (view: WorkspaceNavigationView) => this.registerWorkspaceNavigation(view),
          search: this.search, searchOpen: $searchOpen, logNavigation: this.logNavigation,
          favoritesData: this.favoritesData, qaNavigation: this.qaNavigation,
          onRegisterDesktopCommands: (commands: DesktopLogCommands) => this.desktopCommands = commands,
          initialDraft: this.drafts.get(activeInstance.namespace),
          onDraftChange: (namespace: string, draft: PreservedLogDraft | undefined) =>
            this.recordDraft(namespace, draft),
          onCaptureDraft: (capture: () => Promise<PreservedLogDraft | undefined>) => this.captureDraft = capture })
          .visibility(this.selectedModule === 0 || this.modules.outgoingTab === 0 ? Visibility.Visible : Visibility.None)
          .opacity(this.selectedModule === 0 ? this.modules.moduleReveal : 1)
          .hitTestBehavior(this.selectedModule === 0 && !this.modules.pendingLogDate ? HitTestMode.Default : HitTestMode.None)
          .zIndex(this.selectedModule === 0 ? 1 : 0)
  }

  build() {
    Column() {
      if (this.desktopWindowChrome) {
        DesktopTitleBar({ getEntries: (menu: string) => this.windowMenuEntries(menu),
          focusRevision: this.menuFocusRevision,
          onOpenChange: (open: boolean) => this.desktopMenuOpen = open,
          onAction: (id: string) => this.executeWindowMenu(id) })
      }
      Stack() {
      if (this.connected) {
        WorkspaceSurface({ modules: this.modules, reading: this.reading, readingTransition: this.readingTransition,
          onWorkspaceKey: (event: KeyEvent) => this.handleWorkspaceKey(event),
          workspaceTransition: this.workspaceTransition, favoritesData: this.favoritesData, qaNavigation: this.qaNavigation,
          selectedModule: this.selectedModule, wide: this.isWide(), sidebarWidth: this.desktopNavigationWidth(),
          sidebar: this.sidebar, railPopover: $railPopover, moduleFrameHeight: $moduleFrameHeight, keyboardVisible: this.softwareKeyboardVisible,
          themePreference: this.themePreference, desktopThemeOpen: $desktopThemeOpen, logLoadingHint: this.logLoadingHint,
          topMoreOpen: $topMoreOpen, compactSettingsOpen: $compactSettingsOpen,
          desktopKeyboardFocus: this.desktopKeyboardFocus, desktopWindowChrome: this.desktopWindowChrome,
          logSubtitle: this.logSession.day?.headings[0] || this.logSession.selectedDate || '日志',
          searchFocusRevision: $searchFocusRevision,
          onBeforeAppAction: () => this.workspaceNavigationView?.closeLogMenu(),
          logNavigation: this.logNavigation, selectedDate: this.logSession.selectedDate,
          navigationMonthsExpanded: $navigationMonthsExpanded, navigationDayQuery: $navigationDayQuery,
          newLogDate: $newLogDate, calendarMode: $calendarMode, calendarOpen: $calendarOpen,
          logNavigationScroller: this.logNavigationScroller,
          onOpenCalendar: (mode: string) => this.workspaceNavigationView?.openLogDatePicker(mode),
          onLogMonth: (month: string) => this.workspaceNavigationView?.selectLogMonth(month),
          onLogDay: (date: string) => this.workspaceNavigationView?.selectLogDay(date),
          onLogHeading: (day: DaySummary, heading: string, index: number) => this.workspaceNavigationView?.selectLogHeading(day, heading, index),
          onLogDate: (date: string) => this.workspaceNavigationView?.selectLogDate(date),
          onNewLog: (date: string) => this.workspaceNavigationView?.createLog(date),
          onLogRetry: () => this.workspaceNavigationView?.retryLogNavigation(),
          onToday: () => this.workspaceNavigationView?.createLog(this.calendarDate(new Date())),
          logContent: (): void => this.logContent(), search: this.search, searchOpen: $searchOpen,
          onSelect: (index: number) => this.requestModule(index, false, false, () => {}, ''),
          navigationCommands: $workspaceCommands,
          onOpenTaxonomy: () => this.openTaxonomy(), onCloseTaxonomy: () => this.confirmTaxonomyLeave(() => {}),
          onContentArea: (area: Area) => this.workspaceNavigationView?.workspaceAreaChanged(area),
          onWorkspaceArea: (area: Area) => this.workspaceCommands.readingOrigin(area) })
          .width('100%').height('100%')
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
          .onTouch(() => this.desktopKeyboardFocus = false)

      } else {
        LoginPage({ restoreOnAppear: this.restoreOnAppear,
          onInitialReady: () => this.launchReady = true,
          onConnected: (origin: string, capabilities: InstanceCapabilities) => this.connectedTo(origin, capabilities) })
      }
      if (this.launchCoverVisible) {
        Stack() {
          LaunchIntro({ ready: this.launchReady,
            onDismissed: () => this.launchCoverVisible = false })
        }
        .width('100%').height('100%')
        .backgroundColor($r('app.color.canvas'))
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        .zIndex(100)
      }
      if (this.previewImageSource) {
        Stack() {
          Row().width('100%').height('100%').backgroundColor($r('app.color.image_preview_mask'))
            .backdropBlur(3)
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
          ImagePreview({ source: this.previewImageSource,
            onReady: () => this.revealImagePreview(), onClose: () => this.closeImagePreview() })
        }.width('100%').height('100%').opacity(this.imagePreviewOpacity).zIndex(110)
      }
      if (this.settingsOpen) {
        SettingsPanel({ onClose: () => this.settingsOpen = false }).zIndex(100)
          .transition(floatingSurfaceTransition())
      }
      if (this.aboutOpen) {
        AboutPanel({ onClose: () => this.aboutOpen = false }).zIndex(100)
          .transition(floatingSurfaceTransition())
      }
      if (this.helpOpen) {
        HelpPanel({ onClose: () => this.helpOpen = false }).zIndex(100)
          .transition(floatingSurfaceTransition())
      }
      }.width('100%').layoutWeight(1).backgroundColor($r('app.color.canvas'))
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      .onAreaChange((_oldArea, area) => this.updateBreakpoint(Number(area.width)))
      .onKeyEvent((event: KeyEvent) => this.handleWorkspaceKey(event))
      .parallelGesture(PanGesture({ direction: PanDirection.All, distance: 6 })
        .onActionStart((event: GestureEvent) => this.handleNavigationPanStart(event))
        .onActionEnd((event: GestureEvent) => this.handleNavigationPanEnd(event))
        .onActionCancel(() => this.cancelNavigationPan()))
  }
}

import { WorkspaceBreakpoint, WORKSPACE_TABS, READING_MAX_WIDTH } from '../../common/AppConfig';
import { apiClient, ApiError, ApiUploadFile } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { AppLogo } from '../../common/ui/AppLogo';
import { SourceEditor, SourceEditorSession, EditorSnapshot, EditorImageData } from '../../common/editor/SourceEditor';
import { common } from '@kit.AbilityKit';
import { LengthMetrics } from '@kit.ArkUI';
import { saveExport } from '../../common/files/DocumentExport';
import { EditorLinkPicker } from '../../common/editor/EditorLinkPicker';
import { DayEntry, DaySummary, MonthSummary } from './LogModels';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';
import { LogNavigation } from './components/LogNavigation';
import { DesktopLogHeader } from './components/DesktopLogHeader';
import { ReadingLogHeader } from './components/ReadingLogHeader';
import { CompactLogHeader } from './components/CompactLogHeader';
import { BackupPanel } from './components/BackupPanel';
import { LogImageUpload } from './LogImageUpload';
import { LogSearchPanel, LogSearchResult } from './LogSearchPanel';
import { LogSearchRepository } from './LogSearchRepository';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { LogDisplayModeControl } from './components/LogDisplayModeControl';
import { SearchField } from '../../common/ui/FormControls';
import { ActionPanelHeader } from '../../common/ui/WorkspaceChrome';
import { workspaceKey } from '../../common/ui/WorkspaceKeys';
import { KeyCode, pointer } from '@kit.InputKit';
import { FrameAction } from '../../common/ui/FrameAction';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { NavigationRefresh } from '../../common/ui/NavigationRefresh';
import { DelayedLoadingHint } from '../../common/ui/DelayedLoadingHint';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { expandSection, floatingSurfaceTransition, revealPanel, secondaryPageTransition } from '../../common/ui/WorkspaceMotion';
import { NavigationRefreshController, NavigationSnapshot } from '../../app/NavigationRefreshController';
import { DesktopLogCommands, DesktopMenuEntry } from '../../app/DesktopMenu';
import { iconTint } from '../../common/ui/IconTint';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { ToolbarDensity, resolveToolbarDensity, toolbarActionWidth, toolbarActionsWidth } from '../../common/ui/ToolbarLayout';
import { TaxonomyManagerPage } from '../stats/TaxonomyManagerPage';
import { StatsPage } from '../stats/StatsPage';
import { StatsEntry } from '../stats/StatsModels';
import { StatsNavigation } from '../stats/components/StatsNavigation';
import { FavoritesController } from '../favorites/FavoritesController';
import { FavoritesPage } from '../favorites/FavoritesPage';
import { FavoritesNavigation } from '../favorites/components/FavoritesNavigation';
import { FavoriteHeading } from '../favorites/FavoriteModels';
import { LogFavoriteGroupPanel } from './components/LogFavoriteGroupPanel';
import { workspacePreferences } from '../../common/storage/WorkspacePreferences';
import { appFeedback } from '../../common/ui/AppFeedback';
import { NotesPage } from '../notes/NotesPage';
import { NotesNavigation } from '../notes/components/NotesNavigation';
import { StudyNoteFacet } from '../notes/NoteModels';
import { SearchHistoryStore } from './SearchHistoryStore';
import { SearchHistoryList } from '../../app/components/SearchHistoryList';
import { LogAiController } from './LogAiController';
import { LogAiMaterialImport } from './LogAiMaterialImport';
import { LogAiPanel } from './components/LogAiPanel';
import { LogHighlightReview } from './components/LogHighlightReview';
import { QaPage } from '../qa/QaPage';
import { QaNavigation } from '../qa/components/QaNavigation';
import { QaNavigationController } from '../qa/QaNavigationController';
import { RagSessionSummary } from '../qa/QaModels';
import { AppTopBar, BottomNavigation } from '../../app/components/WorkspaceNavigation';
import { PreservedLogDraft, restoredLogDraft } from './LogDraftPolicy';
import { WorkspaceTransitionCoordinator } from '../../app/WorkspaceTransitionCoordinator';
import { ReadingTransitionCoordinator } from '../../app/ReadingTransitionCoordinator';
import { BackToTopControl } from '../../common/ui/BackToTopControl';

export { PreservedLogDraft } from './LogDraftPolicy';

interface LogOutlineHeading { id: string; text: string; level: number; }
interface AddFavoriteResponse { favorite: FavoriteHeading; }
interface AddFavoriteRequest { date: string; headingText: string; headingId: string; level: number; }

@Component
export struct LogsReaderPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @StorageProp('softwareKeyboardVisible') private softwareKeyboardVisible: boolean = false;
  @StorageLink('themePreference') private themePreference: string = 'system';
  onChangeServer: () => void = () => {};
  onOpenSettings: () => void = () => {};
  onOpenAbout: () => void = () => {};
  onOpenHelp: () => void = () => {};
  onSetTheme: (value: string) => void = () => {};
  onDraftChange: (namespace: string, draft: PreservedLogDraft | undefined) => void = () => {};
  onCaptureDraft: (capture: () => Promise<PreservedLogDraft | undefined>) => void = () => {};
  onRegisterDesktopCommands: (commands: DesktopLogCommands) => void = () => {};
  initialDraft: PreservedLogDraft | undefined = undefined;
  @State private months: MonthSummary[] = [];
  @State private days: DaySummary[] = [];
  @State private month: string = '';
  @State private selectedDate: string = '';
  @State private day: DayEntry | undefined = undefined;
  @State private monthsLoading: boolean = true;
  @State private daysLoading: boolean = false;
  @State private dayLoading: boolean = false;
  @State private readFailed: boolean = false;
  @State private errorMessage: string = '';
  @State private navigationError: string = '';
  private retryRead: () => Promise<void> = async () => this.loadMonths();
  @State private navigationOpen: boolean = false;
  @State private navigationClosing: boolean = false;
  @State private navigationOffset: number = -340;
  @State private navigationScrimOpacity: number = 0;
  private navigationMotionRevision: number = 0;
  @State private outlineOpen: boolean = false;
  @State private outlineClosing: boolean = false;
  @State private outlineOffset: number = 340;
  @State private outlineScrimOpacity: number = 0;
  private outlineMotionRevision: number = 0;
  private pendingOutlineOpen: boolean = false;
  private outlineGestureActive: boolean = false;
  @State private taxonomyOpen: boolean = false;
  @State private taxonomyDirty: boolean = false;
  @State private taxonomyBusy: boolean = false;
  @State @Watch('moduleNavigationChanged') private statsOpen: boolean = false;
  @State @Watch('moduleNavigationChanged') private favoritesOpen: boolean = false;
  @State @Watch('moduleNavigationChanged') private notesOpen: boolean = false;
  @State @Watch('moduleNavigationChanged') private qaOpen: boolean = false;
  @State private qaBusy: boolean = false;
  @State private qaDirty: boolean = false;
  @State private qaPending: boolean = false;
  @State private qaSessionId: string = '';
  @State private qaRequestRevision: number = 0;
  @State private qaDiscardRevision: number = 0;
  @State private qaQuestionFocusRevision: number = 0;
  @State private qaQuery: string = '';
  @State private qaNavigation: QaNavigationController = new QaNavigationController(apiClient, {
    active: () => this.qaOpen, busy: () => this.qaBusy,
    setBusy: (value: boolean) => this.qaBusy = value,
    activeSession: () => this.qaSessionId,
    clearSession: () => { this.qaSessionId = ''; this.qaRequestRevision++; }
  });
  @State private notesDirty: boolean = false;
  @State private notesBusy: boolean = false;
  @State private noteYears: StudyNoteFacet[] = [];
  @State private noteTags: StudyNoteFacet[] = [];
  @State private noteCount: number = 0;
  @State private noteYearFilter: string = 'all';
  @State private noteTagFilter: string = 'all';
  @State private noteNewRevision: number = 0;
  @State private noteDiscardRevision: number = 0;
  @State private noteSaveRevision: number = 0;
  @State private favoritesData: FavoritesController = new FavoritesController(apiClient);
  private navigationRefresh: NavigationRefreshController = new NavigationRefreshController(apiClient);
  @State private favoriteBusy: boolean = false;
  @State private favoriteSuccessHeadingId: string = '';
  @State private favoriteDeleteId: string = '';
  @State private favoriteGroupDialogId: string = '';
  @State private favoriteGroupDialogOpen: boolean = false;
  private favoriteSuccessRevision: number = 0;
  private favoriteSuccessTimer: number = -1;
  @StorageProp('pref_favoritesView') private favoritesViewMode: string = 'list';
  @State private statsMonths: MonthSummary[] = [];
  @State private statsMonth: string = '';
  @State private statsMonthsLoading: boolean = false;
  @State private statsMonthsError: string = '';
  @State private statsMonthRevision: number = 0;
  @State private statsRefreshRevision: number = 0;
  @State private outgoingTab: number = -1;
  @State private moduleReveal: number = 1;
  @State private readingTransition: ReadingTransitionCoordinator = new ReadingTransitionCoordinator();
  @State private logsReadingMode: boolean = false;
  @State private readingProgress: number = 0;
  @State private readingCoverX: number = 0;
  @State private readingCoverY: number = 0;
  @State private readingCoverWidth: number = 0;
  @State private readingCoverHeight: number = 0;
  @State private readingImageInset: number = 0;
  private readingImageWidth: number = 0;
  private readingImageHeight: number = 0;
  private workspaceOriginX: number = 0;
  private workspaceOriginY: number = 0;
  @State private qaLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  @State private logLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  @State private notesLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  @State private favoritesLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  @State private statsLoadingHint: LoadingHintPlacement = new LoadingHintPlacement();
  private readingViewportX: number = 0;
  private readingViewportY: number = 0;
  private readingViewportWidth: number = 0;
  private readingViewportHeight: number = 0;
  @State private readingOutlineOpen: boolean = false;
  @State private readerReady: boolean = false;
  @State private renderedPreviewDate: string = '';
  @State private previewOffset: number = 0;
  @State private previewProgress: number = 0;
  @State private previewTopRequest: number = 0;
  @State private previewRestoreOffset: number = 0;
  private previewScrollOffsets: Record<string, number> = {};
  @State private workspaceLayoutRevision: number = 0;
  @State private workspaceTransition: WorkspaceTransitionCoordinator = new WorkspaceTransitionCoordinator({
    tab: () => this.selectedTab(),
    canCapture: (kind: string) => this.isWide() &&
      (kind === 'module' || ((kind === 'document' || kind === 'mode') && this.selectedTab() === 0 && !!this.day)),
    capture: () => this.getUIContext().getComponentSnapshot().get('module_frame',
      { waitUntilRenderFinished: true }),
    fade: (update: () => void, finished: () => void) => {
      this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseOut, onFinish: finished }, update);
    }
  });
  private moduleSwitchRevision: number = 0;
  @State private collapsedModules: boolean[] = [false, false, false, false, false];
  @State private railPopover: string = '';
  @State private moduleFrameHeight: number = 0;

  private isDesktopNavigationCollapsed(): boolean { return this.collapsedModules[this.selectedTab()]; }

  private moduleNavigationChanged(): void {
    this.railPopover = '';
    this.sidebarMotionRevision++;
    this.sidebarAnimating = false;
    this.finishToolbarMotion();
  }
  @State private sidebarExpansion: number = 1;
  @State private sidebarAnimating: boolean = false;
  private sidebarMotionRevision: number = 0;
  @State private navigationRailHover: string = '';
  @State private navigationMonthsExpanded: boolean = false;
  @State private navigationDayQuery: string = '';
  @State private targetHeading: string = '';
  @State private targetHeadingIndex: number = -1;
  @State private targetKind: string = '';
  @State private targetQuery: string = '';
  @State private targetRevision: number = 0;
  @State private activeOutlineIndex: number = 0;
  @State private headerWidth: number = 600;
  @State private headerDateWidth: number = 190;
  @State private toolbarDensity: ToolbarDensity = ToolbarDensity.OVERFLOW;
  @State private desktopTopBarWidth: number = 0;
  @State private desktopTopBarDensity: ToolbarDensity = ToolbarDensity.OVERFLOW;
  private toolbarMotionWidth: number = -1;
  @State private toolbarActionWidths: number[] = [];
  @State private sourceMode: boolean = false;
  @State private splitMode: boolean = false;
  @State private modeLayoutRevision: number = 0;
  private modeRequestRevision: number = 0;
  @State private editorReady: boolean = false;
  @State private draftText: string = '';
  @State private editorInitialText: string = '';
  @State private previewText: string = '';
  @State private savedText: string = '';
  private draftBaseVersion: string | null = null;
  @State private dirty: boolean = false;
  @State private saving: boolean = false;
  @State private deleting: boolean = false;
  @State private backupOpen: boolean = false;
  @State private backupMaximized: boolean = false;
  @State private backupBusy: boolean = false;
  @State private linkOpen: boolean = false;
  @State private linkOpening: boolean = false;
  @State private imageBusy: boolean = false;
  @State private exportBusy: boolean = false;
  @State private exportMenuOpen: boolean = false;
  @State private hoveredExport: string = '';
  @State private searchOpen: boolean = false;
  @State private searchFocusRevision: number = 0;
  @State private searchQuery: string = '';
  @State private searchHeadingsOnly: boolean = false;
  @State private searchIgnoreCase: boolean = true;
  @State private searchLoading: boolean = false;
  @State private searchSubmitted: boolean = false;
  @State private searchError: string = '';
  @State private searchResults: LogSearchResult[] = [];
  @State private searchHistory: string[] = [];
  @State private aiOpen: boolean = false;
  @State private aiOffset: number = 420;
  @State private aiPanelWidth: number = 340;
  @State private aiAvailableWidth: number = 800;
  @State private aiResizeHovered: boolean = false;
  @State private aiResizing: boolean = false;
  private aiWidthAdjusted: boolean = false;
  private aiResizeStart: number = 340;
  private aiClosing: boolean = false;
  private aiAnimating: boolean = false;
  private aiMotionRevision: number = 0;
  @State private aiMode: string = 'generate';
  @State private ai: LogAiController = new LogAiController(apiClient);
  @StorageProp('pref_rememberSearch') private rememberSearch: boolean = true;
  @State private linkAlias: string = '';
  @State private moreOpen: boolean = false;
  @State private topMoreOpen: boolean = false;
  @State private compactSettingsOpen: boolean = false;
  @State private hoveredMoreAction: string = '';
  @State private saveError: string = '';
  @State private newLogDate: string = '';
  @State private calendarMonth: string = '';
  @State private calendarDates: string[] = [];
  @State private calendarMode: string = 'create';
  @State private calendarOpen: boolean = false;
  @State private calendarLoading: boolean = false;
  @State private calendarError: boolean = false;
  private reads: LogReadRepository = new LogReadRepository(apiClient);
  private writes: LogWriteRepository = new LogWriteRepository(apiClient);
  private searches: LogSearchRepository = new LogSearchRepository(apiClient);
  private searchHistoryStore: SearchHistoryStore = new SearchHistoryStore();
  private editor: SourceEditorSession = new SourceEditorSession();
  private lifecycle: number = 0;
  private listRevision: number = 0;
  private dayRevision: number = 0;
  private restoredDraftApplied: boolean = false;
  private leaveCheckPending: boolean = false;
  private calendarRevision: number = 0;
  private linkTarget: EditorSnapshot | undefined = undefined;
  private searchRevision: number = 0;
  @State private topRequests: number[] = [0, 0, 0, 0, 0];
  private focusRegion: number = -1;
  private logNavigationScroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.collapsedModules = [0, 1, 2, 3, 4].map((index: number) =>
      AppStorage.get<boolean>(`pref_sidebarCollapsed${index}`) || false);
    this.lifecycle++;
    this.favoritesData.load();
    const commands = new DesktopLogCommands();
    commands.entries = (menu: string): DesktopMenuEntry[] => {
      if (menu === '文件') return [
        new DesktopMenuEntry('newLog', '新建日志…', true, false, 'Ctrl+Alt+N'),
        new DesktopMenuEntry('refresh', '刷新', !!this.day && !this.dirty),
        new DesktopMenuEntry('export', '导出', !!this.day?.exists),
        new DesktopMenuEntry('backup', '备份', !!this.day?.exists)
      ];
      if (menu === '编辑') return [new DesktopMenuEntry('save', '保存', this.dirty && !this.saving, false, 'Ctrl+S')];
      if (menu === '视图') return [
        new DesktopMenuEntry('sidebar', '左侧导航', this.isWide() && !this.logsReadingMode,
          !this.isDesktopNavigationCollapsed()),
        new DesktopMenuEntry('reading', '阅读模式', this.selectedTab() === 0 && !!this.day &&
          !this.sourceMode && !this.splitMode, this.logsReadingMode),
        new DesktopMenuEntry('preview', '浏览', !!this.day, !this.sourceMode && !this.splitMode),
        new DesktopMenuEntry('source', '源码', !!this.day, this.sourceMode),
        new DesktopMenuEntry('split', '分屏', !!this.day, this.splitMode)
      ];
      return [];
    };
    commands.execute = (id: string): void => {
      if (id === 'newLog') this.openCalendar('create');
      else if (id === 'refresh') this.refreshLog();
      else if (id === 'export') this.exportMenuOpen = true;
      else if (id === 'backup') this.backupOpen = true;
      else if (id === 'save') this.save();
      else if (id === 'sidebar') this.setDesktopNavigationCollapsed(!this.isDesktopNavigationCollapsed());
      else if (id === 'reading') this.setLogsReadingMode(!this.logsReadingMode);
      else if (id === 'preview') this.switchMode(false);
      else if (id === 'source') this.switchMode(true);
      else if (id === 'split') this.switchMode(false, true);
    };
    commands.handleKey = (event: KeyEvent): boolean => this.handleWorkspaceKey(event);
    commands.editing = (): boolean => this.sourceMode || this.splitMode;
    commands.editorFocused = (): boolean => (this.sourceMode || this.splitMode) && this.editor.focused;
    commands.blocked = (): boolean => this.shortcutBlocked();
    commands.navigate = (offset: number): void => {
      if (!this.sourceMode && !this.splitMode && !this.dayLoading && !this.daysLoading) this.navigateDay(offset);
    };
    this.onRegisterDesktopCommands(commands);
    this.onCaptureDraft(() => this.captureDraft());
    this.editor.onReadyChange = (ready: boolean) =>
      this.editorReady = ready && this.editor.loadedDocumentKey === this.selectedDate;
    this.editor.onDocumentLoaded = (documentKey: string) => {
      if (documentKey !== this.selectedDate) return;
      this.editorReady = true;
      if (!(this.sourceMode || this.splitMode && !this.isWide())) return;
      this.getUIContext().postFrameCallback(new FrameAction(() => {
        if (documentKey === this.selectedDate && (this.sourceMode || this.splitMode && !this.isWide())) {
          this.workspaceTransition.finish('mode');
          this.workspaceTransition.finish('document');
        }
      }));
    };
    this.editor.onChange = (snapshot: EditorSnapshot) => {
      if (snapshot.documentKey !== this.selectedDate) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      if (this.splitMode) this.previewText = snapshot.text;
      this.reportDraft();
    };
    this.editor.onDirty = (key: string) => {
      if (key === this.selectedDate) { this.dirty = true; this.reportDraft(); }
    };
    this.editor.onFailure = (message: string) => {
      this.saveError = message;
      if (this.sourceMode || this.splitMode && !this.isWide()) {
        this.workspaceTransition.finish('mode');
        this.workspaceTransition.finish('document');
      }
    };
    this.editor.onCommand = (command: string) => {
      if (command === 'save') this.save();
      else if (command === 'globalSearch') this.searchOpen = true;
    };
    this.editor.onImages = (target: EditorSnapshot, images: EditorImageData[]) => this.receiveImages(target, images);
    const lifecycle = this.lifecycle;
    this.searchHistoryStore.load(this.getUIContext().getHostContext() as common.UIAbilityContext,
      activeInstance.namespace).then((items: string[]) => {
        if (lifecycle === this.lifecycle) this.searchHistory = items;
      });
    this.loadMonths();
  }

  aboutToDisappear(): void {
    this.navigationRefresh.invalidate();
    this.closeFavoriteFeedback();
    this.onRegisterDesktopCommands(new DesktopLogCommands());
    this.moduleSwitchRevision++;
    this.modeRequestRevision++;
    this.readingTransition.clear();
    this.workspaceTransition.clear();
    this.sidebarMotionRevision++;
    this.ai.dispose();
    this.favoritesData.dispose();
    this.lifecycle++;
    this.listRevision++;
    this.dayRevision++;
    this.calendarRevision++;
    this.searchRevision++;
    this.reads.invalidate();
    this.editor.onChange = () => {};
    this.editor.onDirty = () => {};
    this.editor.onFailure = () => {};
    this.editor.onReadyChange = () => {};
    this.editor.onDocumentLoaded = () => {};
    this.editor.onCommand = () => {};
    this.editor.onImages = () => {};
    this.closeLink(false);
    this.onCaptureDraft(async () => undefined);
  }

  private isWide(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private selectedTab(): number {
    return this.notesOpen ? 1 : this.favoritesOpen ? 2 : this.qaOpen ? 3 : this.statsOpen ? 4 : 0;
  }

  private shortcutBlocked(): boolean {
    return this.backupOpen || this.linkOpen || this.ai.reviewOpen || this.imageBusy || this.exportBusy ||
      this.saving || this.deleting || this.taxonomyOpen || this.topMoreOpen || this.compactSettingsOpen || this.moreOpen ||
      this.exportMenuOpen || this.calendarOpen || !!this.railPopover || this.searchOpen ||
      this.navigationOpen || this.outlineOpen || !!this.qaNavigation.qaRenameId || !!this.qaNavigation.qaMenuId;
  }

  private focusWorkspaceRegion(reverse: boolean): void {
    const regions = this.logsReadingMode ? ['module_frame'] : ['global_log_search',
      this.isDesktopNavigationCollapsed() ? 'sidebar_rail_expand' : 'sidebar_collapse', 'module_frame'];
    for (let index = 0; index < regions.length; index++) {
      this.focusRegion = (this.focusRegion + (reverse ? -1 : 1) + regions.length) % regions.length;
      if (focusControl.requestFocus(regions[this.focusRegion])) break;
    }
  }

  private handleWorkspaceKey(event: KeyEvent): boolean {
    if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) {
      if (this.topMoreOpen) this.topMoreOpen = false;
      else if (this.compactSettingsOpen) this.compactSettingsOpen = false;
      else if (this.moreOpen) this.moreOpen = false;
      else if (this.exportMenuOpen) this.exportMenuOpen = false;
      else if (this.calendarOpen) this.calendarOpen = false;
      else if (this.railPopover) this.railPopover = '';
      else if (this.qaNavigation.qaRenameId) this.qaNavigation.qaRenameId = '';
      else if (this.qaNavigation.qaMenuId) this.qaNavigation.qaMenuId = '';
      else if (this.readingOutlineOpen) this.readingOutlineOpen = false;
      else if (this.outlineOpen) this.closeOutline();
      else if (this.searchOpen) this.closeSearch();
      else if (this.navigationOpen) this.closeNavigation();
      else if (this.logsReadingMode && !this.shortcutBlocked()) this.setLogsReadingMode(false);
      else return false;
      return true;
    }
    if (this.shortcutBlocked()) return false;
    if (workspaceKey(event, KeyCode.KEYCODE_F6) || workspaceKey(event, KeyCode.KEYCODE_F6, false, true)) {
      if (!this.isWide()) return false;
      this.focusWorkspaceRegion(!!event.getModifierKeyState?.(['Shift']));
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_F, true, true)) {
      if (this.isWide()) this.searchFocusRevision++;
      else this.searchOpen = true;
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_UP, false, false, true)) {
      if (this.selectedTab() === 0) this.previewTopRequest++;
      else {
        const requests = this.topRequests.slice();
        requests[this.selectedTab()]++;
        this.topRequests = requests;
      }
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_G, true)) {
      if (this.selectedTab() === 0 && this.editor.focused) return false;
      this.requestModule(0, false, false, () => this.openCalendar('jump'));
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_N, true, false, true)) {
      this.requestModule(0, false, false, () => this.openCalendar('create'));
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_Q, true, false, true)) {
      if (this.qaBusy) return false;
      this.requestModule(3, false, false, () => this.switchQaSession('', true));
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_S, true)) {
      if (this.notesOpen) this.noteSaveRevision++;
      else if (this.selectedTab() === 0) this.save();
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_F, true) && this.selectedTab() === 0 &&
      (this.sourceMode || this.splitMode)) {
      this.editor.command('find');
      return true;
    }
    if (this.selectedTab() === 0 && !this.sourceMode && !this.splitMode) {
      if (workspaceKey(event, KeyCode.KEYCODE_DPAD_LEFT, false, false, true)) {
        if (!this.dayLoading && !this.daysLoading) this.navigateDay(1);
        return true;
      }
      if (workspaceKey(event, KeyCode.KEYCODE_DPAD_RIGHT, false, false, true)) {
        if (!this.dayLoading && !this.daysLoading) this.navigateDay(-1);
        return true;
      }
    }
    return false;
  }

  private async setLogsReadingMode(active: boolean): Promise<void> {
    if (!this.isWide() || this.selectedTab() !== 0 || !this.day || this.sourceMode || this.splitMode ||
      active === this.logsReadingMode || this.readingTransition.animating || this.sidebarAnimating ||
      this.workspaceTransition.task || this.workspaceTransition.snapshot ||
      (active && this.renderedPreviewDate !== this.selectedDate)) return;
    this.readingOutlineOpen = false;
    const revision = this.readingTransition.begin();
    if (this.readingViewportWidth > 0) {
      try {
        const snapshot = await this.getUIContext().getComponentSnapshot().get('log_reading_surface',
          { waitUntilRenderFinished: true });
        if (revision !== this.readingTransition.revision) { snapshot.release(); return; }
        this.readingCoverX = this.readingViewportX;
        this.readingCoverY = this.readingViewportY;
        this.readingCoverWidth = this.readingImageWidth = this.readingViewportWidth;
        this.readingCoverHeight = this.readingImageHeight = this.readingViewportHeight;
        this.readingImageInset = 0;
        await this.readingTransition.install(snapshot, revision);
      } catch (_) {
        // A failed capture must not block the mode change.
      }
    }
    if (revision !== this.readingTransition.revision) return;
    this.readingTransition.viewportReady = false;
    this.readingTransition.motionFinished = false;
    this.logsReadingMode = active;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut, onFinish: () => {
      if (revision !== this.readingTransition.revision) return;
      this.readingTransition.motionFinished = true;
      this.workspaceLayoutRevision++;
      this.readingTransition.finish();
    } }, () => this.readingProgress = active ? 1 : 0);
  }

  private readingViewportChanged(area: Area): void {
    this.readingViewportX = Number(area.globalPosition.x) - this.workspaceOriginX;
    this.readingViewportY = Number(area.globalPosition.y) - this.workspaceOriginY;
    this.readingViewportWidth = Number(area.width);
    this.readingViewportHeight = Number(area.height);
    if (!this.readingTransition.snapshot || !this.readingTransition.animating) return;
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut }, () => {
      this.readingCoverX = this.readingViewportX;
      this.readingCoverY = this.readingViewportY;
      this.readingCoverWidth = this.readingViewportWidth;
      this.readingCoverHeight = this.readingViewportHeight;
      this.readingImageInset = Math.max(0, (this.readingViewportWidth - READING_MAX_WIDTH) / 2) -
        Math.max(0, (this.readingImageWidth - READING_MAX_WIDTH) / 2);
    });
  }

  private openNavigation(): void {
    if (this.isWide() || this.navigationOpen) return;
    const revision = ++this.navigationMotionRevision;
    this.navigationClosing = false;
    this.navigationOffset = -340;
    this.navigationScrimOpacity = 0;
    this.navigationOpen = true;
    revealPanel(this.getUIContext(), () => revision === this.navigationMotionRevision &&
      this.navigationOpen && !this.navigationClosing, () => {
      this.navigationOffset = 0;
      this.navigationScrimOpacity = 1;
      this.getUIContext().getFocusController().requestFocus('navigation_drawer_close');
    });
  }

  private closeNavigation(): void {
    this.railPopover = '';
    if (!this.navigationOpen || this.navigationClosing) return;
    const revision = ++this.navigationMotionRevision;
    this.navigationClosing = true;
    animateTo({ duration: 180, curve: Curve.EaseIn, onFinish: () => {
      if (revision !== this.navigationMotionRevision) return;
      this.navigationOpen = false;
      this.navigationClosing = false;
      this.getUIContext().getFocusController().requestFocus('workspace_navigation_open');
    } }, () => {
      this.navigationOffset = -340;
      this.navigationScrimOpacity = 0;
    });
  }

  private openOutline(): void {
    if (this.outlineOpen || this.navigationOpen || this.outlineHeadings().length === 0) return;
    this.favoritesData.load();
    const revision = ++this.outlineMotionRevision;
    this.outlineClosing = false;
    this.outlineOffset = 340;
    this.outlineScrimOpacity = 0;
    this.outlineOpen = true;
    revealPanel(this.getUIContext(), () => revision === this.outlineMotionRevision &&
      this.outlineOpen && !this.outlineClosing, () => {
      this.outlineOffset = 0;
      this.outlineScrimOpacity = 1;
    });
  }

  private closeOutline(): void {
    if (!this.outlineOpen || this.outlineClosing) return;
    const revision = ++this.outlineMotionRevision;
    this.outlineClosing = true;
    animateTo({ duration: 180, curve: Curve.EaseIn, onFinish: () => {
      if (revision !== this.outlineMotionRevision) return;
      this.outlineOpen = false;
      this.outlineClosing = false;
    } }, () => {
      this.outlineOffset = 340;
      this.outlineScrimOpacity = 0;
    });
  }

  private handleActionsDisappear(): void {
    if (!this.pendingOutlineOpen) return;
    this.pendingOutlineOpen = false;
    this.openOutline();
  }

  private handleOutlinePanStart(event: GestureEvent): void {
    if (this.isWide() || this.selectedTab() !== 0 || this.navigationOpen || this.sourceMode ||
      !this.day || !this.readerReady || this.outlineOpen || this.moreOpen || this.aiOpen ||
      this.backupOpen || this.linkOpen || this.searchOpen || this.outlineHeadings().length === 0) {
      this.outlineGestureActive = false;
      return;
    }
    const pan = event as PanGestureEvent;
    const finger = pan.fingerList.length > 0 ? pan.fingerList[0] : undefined;
    const width = Number(pan.target.area.width);
    const startX = finger ? finger.localX - pan.offsetX : -1;
    this.outlineGestureActive = width > 0 && startX >= width - 144 && startX <= width - 16;
  }

  private handleOutlinePanEnd(event: GestureEvent): void {
    if (!this.outlineGestureActive) return;
    const pan = event as PanGestureEvent;
    const horizontalIntent = Math.abs(pan.offsetX) >= Math.abs(pan.offsetY) * 0.8;
    const shouldOpen = horizontalIntent && (pan.offsetX < -48 || pan.velocityX < -450);
    this.outlineGestureActive = false;
    if (shouldOpen) this.openOutline();
  }


  private selectTab(index: number): void {
    if (index === this.selectedTab()) return;
    this.requestModule(index);
  }

  private requestModule(index: number, discardNotes: boolean = false, discardQa: boolean = false,
    afterSwitch: () => void = () => {}): void {
    if (index === this.selectedTab()) { afterSwitch(); return; }
    if (this.taxonomyOpen) {
      this.confirmTaxonomyLeave(() => this.requestModule(index, discardNotes, discardQa, afterSwitch)); return;
    }
    if (this.notesOpen) {
      if (this.notesBusy) return;
      if (this.notesDirty && !discardNotes) {
        AlertDialog.show({ message: '随记尚未保存，确定放弃修改吗？',
          primaryButton: { value: '继续编辑', action: () => {} },
          secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
            this.requestModule(index, true, discardQa, afterSwitch);
          } } });
        return;
      }
    }
    if (this.qaOpen) {
      if (this.qaBusy) { appFeedback.show('请先停止当前回答', 'error'); return; }
      if ((this.qaDirty || this.qaPending) && !discardQa) {
        AlertDialog.show({ message: this.qaPending ? '当前问答尚未保存，确定放弃吗？' :
          '问答输入尚未提交，确定放弃吗？',
          primaryButton: { value: '继续编辑', action: () => {} },
          secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: () => {
            this.requestModule(index, discardNotes, true, afterSwitch);
          } } });
        return;
      }
    }
    const change = (): void => { this.switchModule(index, discardNotes, discardQa, afterSwitch); };
    if (index === 0) change();
    else this.confirmDiscard(change);
  }

  private async switchModule(index: number, discardNotes: boolean, discardQa: boolean,
    afterSwitch: () => void = () => {}): Promise<void> {
    const revision = ++this.moduleSwitchRevision;
    if (this.isWide() && !this.logsReadingMode) {
      this.workspaceTransition.clear();
      await this.workspaceTransition.cover('module');
      if (revision !== this.moduleSwitchRevision) return;
    }
    const covered = this.workspaceTransition.snapshot && this.workspaceTransition.kind === 'module';
    this.outgoingTab = covered ? -1 : this.selectedTab();
    this.moduleReveal = covered ? 1 : 0;
    if (discardNotes) { this.notesDirty = false; this.noteDiscardRevision++; }
    if (discardQa) { this.qaDirty = false; this.qaPending = false; this.qaDiscardRevision++; }
    if (index !== 0) {
      this.readingTransition.clear();
      this.logsReadingMode = false;
      this.readingProgress = 0;
      this.readingOutlineOpen = false;
      this.draftText = this.savedText;
      this.editorInitialText = this.savedText;
      this.previewText = this.savedText;
    }
    this.notesOpen = index === 1;
    this.favoritesOpen = index === 2;
    this.qaOpen = index === 3;
    this.statsOpen = index === 4;
    this.closeNavigation();
    if (index !== 0) this.closeOutline();
    this.closeSearch();
    if (index === 3) this.qaNavigation.loadQaNavigation();
    afterSwitch();
    this.getUIContext().postFrameCallback(new FrameAction(() => {
      if (revision !== this.moduleSwitchRevision) return;
      if (covered) {
        this.workspaceTransition.finish('module');
      } else {
        this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseOut, onFinish: () => {
          if (revision === this.moduleSwitchRevision) this.outgoingTab = -1;
        } }, () => this.moduleReveal = 1);
      }
    }));
  }

  private openTaxonomy(): void {
    this.closeNavigation();
    this.railPopover = '';
    this.taxonomyOpen = true;
  }

  private confirmTaxonomyLeave(action: () => void): void {
    if (this.taxonomyBusy) { appFeedback.show('分类操作正在进行，请稍候'); return; }
    const leave = (): void => { this.taxonomyDirty = false; this.taxonomyOpen = false; action(); };
    if (!this.taxonomyDirty) { leave(); return; }
    AlertDialog.show({ message: '当前分类修改或建议尚未处理，确定放弃吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: leave } });
  }

  private async openStatsEntry(entry: StatsEntry): Promise<void> {
    this.statsOpen = false;
    if (entry.date.slice(0, 7) !== this.month) {
      await this.loadDays(entry.date.slice(0, 7), entry.date);
      if (this.day?.date === entry.date) {
        this.targetHeading = entry.rawHeading;
        this.targetHeadingIndex = entry.headingIndex;
        this.targetRevision++;
      }
      return;
    }
    await this.loadDay(entry.date, entry.rawHeading, entry.headingIndex);
  }

  private confirmNotesLeave(action: () => void): void {
    if (this.notesBusy) return;
    if (!this.notesDirty) { this.notesOpen = false; action(); return; }
    AlertDialog.show({ message: '随记尚未保存，确定放弃修改吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.notesDirty = false;
        this.noteDiscardRevision++;
        this.notesOpen = false;
        action();
      } } });
  }

  private confirmQaLeave(action: () => void): void {
    if (this.qaBusy) { appFeedback.show('请先停止当前回答', 'error'); return; }
    if (!this.qaDirty && !this.qaPending) { this.qaOpen = false; action(); return; }
    AlertDialog.show({ message: this.qaPending ? '当前问答尚未保存，确定放弃吗？' : '问答输入尚未提交，确定放弃吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: () => {
        this.qaDirty = false; this.qaPending = false; this.qaDiscardRevision++; this.qaOpen = false; action();
      } } });
  }

  private switchQaSession(id: string, focusQuestion: boolean = false): void {
    if (this.qaBusy) return;
    const change = (): void => {
      this.qaDirty = false; this.qaPending = false;
      this.closeNavigation();
      this.railPopover = '';
      this.qaSessionId = id; this.qaRequestRevision++;
      if (focusQuestion) setTimeout(() => {
        if (this.qaOpen && !this.qaBusy) this.qaQuestionFocusRevision++;
      }, 40);
    };
    if (!this.qaDirty && !this.qaPending) { change(); return; }
    AlertDialog.show({ message: this.qaPending ? '当前问答尚未保存，确定切换会话吗？' : '问答输入尚未提交，确定切换会话吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: change } });
  }

  private openQaCitation(date: string, heading: string, headingIndex: number): void {
    this.confirmQaLeave(async () => {
      if (date.slice(0, 7) !== this.month) await this.loadDays(date.slice(0, 7), date);
      else await this.loadDay(date);
      this.targetHeading = heading;
      this.targetHeadingIndex = headingIndex;
      this.targetKind = 'citation';
      this.targetRevision++;
    });
  }

  private confirmQaDelete(session: RagSessionSummary): void {
    if (this.qaBusy) return;
    if (session.id === this.qaSessionId && (this.qaDirty || this.qaPending)) {
      appFeedback.show('请先处理当前未保存的问答', 'error'); return;
    }
    AlertDialog.show({ message: `确认删除问答“${session.title}”吗？`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'),
        action: () => this.qaNavigation.deleteQaSession(session.id) } });
  }

  private openNoteLink(date: string, heading: string): void {
    this.confirmNotesLeave(async () => {
      if (date.slice(0, 7) !== this.month) await this.loadDays(date.slice(0, 7), date);
      else await this.loadDay(date);
      this.targetHeading = heading;
      this.targetHeadingIndex = -1;
      this.targetKind = 'internal';
      this.targetRevision++;
    });
  }

  private async openFavorite(favorite: FavoriteHeading): Promise<void> {
    this.favoritesOpen = false;
    if (favorite.date.slice(0, 7) !== this.month) await this.loadDays(favorite.month, favorite.date);
    else await this.loadDay(favorite.date);
    this.targetHeading = favorite.exists ? favorite.headingText : '';
    this.targetHeadingIndex = -1;
    this.targetKind = 'favorite';
    this.targetRevision++;
  }

  private updateToolbarWidth(width: number): void {
    if (this.toolbarMotionWidth >= 0) width = this.toolbarMotionWidth;
    this.headerWidth = width;
    const compactHeading = 32 + this.headerDateWidth + 80 + 24;
    const compact = compactHeading + 32 + 126 + 80 + 7 * 8;
    const fullHeading = 32 + this.headerDateWidth + toolbarActionsWidth(['上一篇', '下一篇']) + 24;
    const documentActions = toolbarActionsWidth(['刷新', '导出', '备份', '删除']);
    const editorActions = this.sourceMode || this.splitMode ?
      toolbarActionsWidth(['内部链接', '插入图片', '放弃修改', '查找替换']) + 8 : 0;
    const full = fullHeading + 3 * toolbarActionWidth('浏览') + 6 + documentActions +
      toolbarActionWidth('保存中') + 40 + editorActions + 9 * 8;
    this.toolbarDensity = resolveToolbarDensity(width, compact, full, this.toolbarDensity);
  }

  private desktopActionSlotWidth(action: string, label: string): number {
    const index = ['refresh', 'export', 'backup', 'delete'].indexOf(action);
    if (index >= 0 && this.toolbarActionWidths.length > index) return this.toolbarActionWidths[index];
    if (!this.documentActionsInHeader(action)) return 0;
    return this.showToolbarLabels(action) ? toolbarActionWidth(label) : 40;
  }

  private desktopActionSlotPresence(action: string, label: string): number {
    return Math.min(1, this.desktopActionSlotWidth(action, label) / 40);
  }

  private showToolbarLabels(group: string = 'mode'): boolean {
    if (this.toolbarDensity === ToolbarDensity.FULL) return true;
    let required = 32 + this.headerDateWidth + 80 + 24 + 32 + 126 + 80;
    for (const action of ['refresh', 'export', 'backup', 'delete']) {
      if (this.documentActionsInHeader(action)) required += 48;
    }
    required += 2 * (toolbarActionWidth('上一篇') - 44 + 24 + 16) - 64;
    if (group === 'navigation') return this.headerWidth >= required + 12;
    required += 3 * (toolbarActionWidth('浏览') - 40);
    if (group === 'mode') return this.headerWidth >= required + 12;
    required += toolbarActionWidth('保存中') - 40;
    if (group === 'save') return this.headerWidth >= required + 12;
    const actions = ['refresh', 'export', 'backup', 'delete'];
    const labels = ['刷新中', '导出', '备份', '删除'];
    for (let index = 0; index < actions.length; index++) {
      if (this.documentActionsInHeader(actions[index])) required += toolbarActionWidth(labels[index]) - 40;
      if (group === actions[index]) return this.headerWidth >= required + 12;
    }
    return false;
  }

  private expandedModeSelector(): boolean {
    return this.isWide() && this.toolbarDensity !== ToolbarDensity.OVERFLOW;
  }

  private documentActionsInHeader(action: string): boolean {
    if (!this.expandedModeSelector()) return false;
    if (this.toolbarDensity === ToolbarDensity.FULL) return true;
    const priority = ['refresh', 'export', 'backup', 'delete'].indexOf(action);
    const compact = 32 + this.headerDateWidth + 80 + 24 + 32 + 126 + 80 + 7 * 8;
    return priority >= 0 && this.headerWidth >= compact + (priority + 1) * 48 + 12;
  }

  private editorActionsInHeader(): boolean {
    return this.isWide() && this.toolbarDensity === ToolbarDensity.FULL && (this.sourceMode || this.splitMode);
  }

  private showDesktopOutline(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE && !this.logsReadingMode && !this.sourceMode &&
      !this.splitMode && this.outlineHeadings().length > 0;
  }

  private outlineHeadings(): LogOutlineHeading[] {
    const headings: LogOutlineHeading[] = [];
    const used: Map<string, number> = new Map<string, number>();
    let inFence = false;
    (this.sourceMode ? this.draftText : this.previewText).split('\n').forEach((line: string) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const match = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
      if (!match) return;
      const title = match[2]
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<\/?[^>]+>/g, '')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (title && !/^\d{4}-\d{2}-\d{2}$/.test(title)) {
        const rawId = title.normalize('NFKC').toLowerCase()
          .replace(/[`*_~()[\]{}<>，。、“”‘’：；！？]/g, '')
          .replace(/\s+/g, '-').replace(/[^\w\u3400-\u9fff-]+/g, '-')
          .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'section';
        const count = used.get(rawId) || 0;
        used.set(rawId, count + 1);
        headings.push({ id: count === 0 ? rawId : `${rawId}-${count + 1}`,
          text: title, level: match[1].length });
      }
    });
    return headings;
  }

  private updateActiveOutline(headingId: string): void {
    const index = this.outlineHeadings().findIndex((heading: LogOutlineHeading) => heading.id === headingId);
    if (index >= 0) this.activeOutlineIndex = index;
  }

  private outlineFavorite(heading: LogOutlineHeading): FavoriteHeading | undefined {
    return this.favoritesData.favorites.find((item: FavoriteHeading) =>
      item.date === this.selectedDate && (item.resolvedHeadingId || item.headingId) === heading.id);
  }

  private favoriteFeedbackVisible(heading: LogOutlineHeading): boolean {
    const favorite = this.outlineFavorite(heading);
    return this.favoriteSuccessHeadingId === heading.id || (!!favorite && this.favoriteDeleteId === favorite.id);
  }

  private closeFavoriteFeedback(): void {
    if (this.favoriteSuccessTimer >= 0) clearTimeout(this.favoriteSuccessTimer);
    this.favoriteSuccessTimer = -1;
    this.favoriteSuccessHeadingId = '';
    this.favoriteDeleteId = '';
    this.favoriteSuccessRevision++;
  }

  private toggleOutlineFavorite(heading: LogOutlineHeading): void {
    if (heading.level !== 3 || this.favoriteBusy) return;
    const favorite = this.outlineFavorite(heading);
    if (favorite) {
      this.favoriteSuccessHeadingId = '';
      this.favoriteDeleteId = favorite.id;
    } else this.addOutlineFavorite(heading);
  }

  private async addOutlineFavorite(heading: LogOutlineHeading): Promise<void> {
    if (!this.selectedDate || this.favoriteBusy) return;
    const date = this.selectedDate;
    const lifecycle = this.lifecycle;
    this.favoriteBusy = true;
    try {
      const request: AddFavoriteRequest = {
        date: this.selectedDate, headingText: heading.text, headingId: heading.id, level: heading.level
      };
      const response = await apiClient.post<AddFavoriteResponse>('/favorites', request);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      this.favoritesData.favorites = [...this.favoritesData.favorites, response.favorite];
      this.favoriteDeleteId = '';
      this.favoriteSuccessHeadingId = heading.id;
      const revision = ++this.favoriteSuccessRevision;
      if (this.favoriteSuccessTimer >= 0) clearTimeout(this.favoriteSuccessTimer);
      this.favoriteSuccessTimer = setTimeout(() => {
        if (lifecycle === this.lifecycle && revision === this.favoriteSuccessRevision &&
          date === this.selectedDate && this.favoriteSuccessHeadingId === heading.id) {
          this.favoriteSuccessTimer = -1;
          this.favoriteSuccessHeadingId = '';
        }
      }, 5200);
    } catch (error) {
      if (lifecycle === this.lifecycle && date === this.selectedDate)
        appFeedback.show(error instanceof ApiError ? error.message : '收藏失败', 'error');
    } finally { if (lifecycle === this.lifecycle) this.favoriteBusy = false; }
  }

  private async removeOutlineFavorite(favorite: FavoriteHeading): Promise<void> {
    if (this.favoriteBusy) return;
    this.favoriteBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    const removed = await this.favoritesData.remove(favorite.id);
    if (lifecycle === this.lifecycle) this.favoriteBusy = false;
    if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
    if (removed) {
      this.closeFavoriteFeedback();
      this.favoriteGroupDialogOpen = false;
      appFeedback.show('已取消收藏', 'success');
    } else appFeedback.show(this.favoritesData.errorMessage, 'error');
  }

  @Builder
  private favoriteFeedbackPopup(heading: LogOutlineHeading) {
    if (this.favoriteSuccessHeadingId === heading.id) {
      Row({ space: 12 }) {
        Text('收藏成功').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          .layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          Row({ space: 5 }) {
            Text('选择分组').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.primary_active'))
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([$r('app.color.primary_active')])
          }
        }.height(34).padding({ left: 10, right: 8 })
          .backgroundColor($r('app.color.primary_tint'))
          .border({ width: 1, color: $r('app.color.primary') }).borderRadius(7).clip(true)
          .onClick(() => {
            const favorite = this.outlineFavorite(heading);
            if (!favorite) return;
            this.closeFavoriteFeedback();
            this.favoriteGroupDialogId = favorite.id;
            this.favoriteGroupDialogOpen = true;
          })
      }.width('100%').height(52).padding({ left: 10, right: 6 })
    } else if (this.outlineFavorite(heading)) {
      Column({ space: 10 }) {
        Text('取消收藏？').width('100%').fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink'))
        Row({ space: 7 }) {
          Blank().layoutWeight(1)
          Button('保留', { type: ButtonType.Normal }).height(32).padding({ left: 10, right: 10 })
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(7).clip(true)
            .onClick(() => this.closeFavoriteFeedback())
          Button('确认', { type: ButtonType.Normal }).height(32).padding({ left: 10, right: 10 })
            .fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.primary_active'))
            .backgroundColor($r('app.color.primary_tint'))
            .border({ width: 1, color: $r('app.color.primary') }).borderRadius(7).clip(true)
            .onClick(() => {
              const favorite = this.outlineFavorite(heading);
              if (favorite) this.removeOutlineFavorite(favorite);
            })
        }.width('100%')
      }.width('100%').padding(10).alignItems(HorizontalAlign.Start)
    }
  }

  private message(error: Error): string {
    return error instanceof ApiError ? error.message : '服务器暂时无法读取日志';
  }

  private reportDraft(): void {
    const namespace = activeInstance.namespace;
    this.onDraftChange(namespace, this.dirty && this.selectedDate ? {
      namespace, date: this.selectedDate, text: this.draftText, baseVersion: this.draftBaseVersion
    } : undefined);
  }

  private async captureDraft(): Promise<PreservedLogDraft | undefined> {
    if (!this.selectedDate) return undefined;
    let text = this.draftText;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey === this.selectedDate) text = snapshot.text;
      } catch (_) { /* Keep the last observed draft if the editor is closing. */ }
    }
    return text !== this.savedText ? { namespace: activeInstance.namespace, date: this.selectedDate,
      text, baseVersion: this.draftBaseVersion } : undefined;
  }

  private bodyFromDay(day: DayEntry): string {
    return day.content.trimEnd().replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, '')
      .replace(/^##\s+\d{4}-\d{2}-\d{2}[^\S\r\n]*\r?\n/, '').replace(/^\r?\n+/, '').trimEnd();
  }

  private confirmDiscard(next: () => void): void {
    if (this.taxonomyOpen) { this.confirmTaxonomyLeave(() => this.confirmDiscard(next)); return; }
    if (this.leaveCheckPending) return;
    this.leaveCheckPending = true;
    this.checkBeforeLeaving(next).finally(() => this.leaveCheckPending = false);
  }

  private async checkBeforeLeaving(next: () => void): Promise<void> {
    if (this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) {
      this.saveError = '操作进行中，请稍候'; return;
    }
    if (this.day && this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.selectedDate) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    if (!this.dirty) { next(); return; }
    if (!this.editorReady) { this.saveError = '编辑器尚未就绪，请稍后重试'; return; }
    AlertDialog.show({ message: '当前日志修改尚未保存，是否放弃修改？', autoCancel: false,
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.discardDraft().then(() => { if (!this.dirty) next(); });
      } }
    });
  }

  private async switchMode(source: boolean, split: boolean = false): Promise<void> {
    const revision = ++this.modeRequestRevision;
    if (source === this.sourceMode && split === this.splitMode) return;
    if (this.editorReady && this.day) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.selectedDate) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
        this.previewText = snapshot.text;
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '编辑器尚未就绪';
        return;
      }
    }
    if (revision !== this.modeRequestRevision) return;
    if (!source && !split && this.editorReady) {
      try { await this.editor.command('blur'); } catch (_) { return; }
    }
    if (revision !== this.modeRequestRevision) return;
    if (this.isWide() && this.day && this.selectedTab() === 0) {
      this.workspaceTransition.clear();
      await this.workspaceTransition.cover('mode');
      if (revision !== this.modeRequestRevision) return;
    }
    this.sourceMode = source;
    this.splitMode = split;
    this.updateToolbarWidth(this.headerWidth);
    this.modeLayoutRevision++;
    if (!this.day || this.dayLoading || this.daysLoading ||
      (source && this.editor.loadedDocumentKey === this.selectedDate)) {
      this.getUIContext().postFrameCallback(new FrameAction(() => {
        if (revision === this.modeRequestRevision) this.workspaceTransition.finish('mode');
      }));
    }
  }

  private async save(): Promise<void> {
    if (!this.day || !this.editorReady || this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) return;
    const lifecycle = this.lifecycle;
    const revision = this.dayRevision;
    const date = this.day.date;
    this.saving = true;
    this.saveError = '';
    try {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
      if (!this.dirty) return;
      if (this.draftBaseVersion !== this.day.version) {
        this.saveError = '恢复的草稿基于旧版本，服务器内容已变化。请复制草稿并刷新核对，未覆盖服务器。';
        return;
      }
      const response = await this.writes.save({ date, content: snapshot.text, baseVersion: this.day.version });
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision || this.day?.date !== date) return;
      if (!response.day || response.day.date !== date || !response.day.version) throw new Error('保存响应格式异常');
      this.day = response.day;
      this.savedText = snapshot.text;
      this.draftBaseVersion = response.day.version;
      this.dirty = this.draftText !== snapshot.text;
      this.reportDraft();
      this.previewText = this.draftText;
      this.reads.invalidate();
      this.refreshNavigation(date);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未覆盖。当前草稿仍保留，请先复制内容再刷新核对。' :
          error instanceof Error ? error.message : '保存失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.saving = false;
    }
  }

  private async refreshNavigation(date: string): Promise<void> {
    const lifecycle = this.lifecycle;
    const month = date.slice(0, 7);
    try {
      const result = await Promise.all([this.reads.months(), this.reads.days(month)]);
      if (lifecycle !== this.lifecycle) return;
      this.months = result[0].months;
      if (this.month === month && this.selectedDate === date) {
        this.days = result[1].days;
        this.navigationError = '';
      }
    } catch (error) {
      if (lifecycle === this.lifecycle && this.month === month && this.selectedDate === date) {
        this.navigationError = this.message(error as Error);
      }
    }
  }

  private async beforeRestore(): Promise<boolean> {
    if (!this.day || !this.backupOpen) return false;
    if (this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.selectedDate) return false;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
    }
    return new Promise<boolean>((resolve) => {
      AlertDialog.show({ title: '恢复此版本', autoCancel: false,
        message: `仅恢复 ${this.selectedDate} 日块，恢复前会再次保留现有文件。` +
          (this.dirty ? '\n当前编辑器有未保存修改，恢复会放弃这些修改。' : ''),
        primaryButton: { value: '取消', action: () => resolve(false) },
        secondaryButton: { value: '恢复', action: () => resolve(true) },
        cancel: () => resolve(false) });
    });
  }

  private applyRestoredDay(day: DayEntry): void {
    if (day.date !== this.selectedDate) return;
    this.day = day;
    const body = this.bodyFromDay(day);
    this.savedText = body;
    this.draftBaseVersion = day.version;
    this.draftText = body;
    this.editorInitialText = body;
    this.previewText = body;
    this.dirty = false;
    this.reportDraft();
    this.sourceMode = false;
    this.splitMode = false;
    this.saveError = '';
    this.reads.invalidate();
    this.refreshNavigation(day.date);
    this.backupOpen = false;
  }

  private async openLink(): Promise<void> {
    if (!this.day || !this.editorReady || this.linkOpen || this.linkOpening || this.backupOpen) return;
    this.moreOpen = false;
    this.linkOpening = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    let target: EditorSnapshot | undefined = undefined;
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      target = await this.editor.command('capture');
      if (lifecycle !== this.lifecycle || target.documentKey !== date) return;
      await this.editor.command('blur');
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      this.linkTarget = target;
      this.linkAlias = target.text.slice(target.from, target.to);
      this.linkOpen = true;
      target = undefined;
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '无法打开内部链接';
    } finally {
      if (target) this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.linkOpening = false;
    }
  }

  private async insertLink(markup: string): Promise<void> {
    const target = this.linkTarget;
    if (!target || !this.linkOpen || target.documentKey !== this.selectedDate) throw new Error('插入位置已变化，请重新打开');
    await this.editor.insert(target, markup);
    this.closeLink();
  }

  private closeLink(refocus: boolean = true): void {
    this.linkOpen = false;
    const target = this.linkTarget;
    this.linkTarget = undefined;
    if (!target) return;
    this.editor.release(target).then(() => {
      if (refocus && this.editorReady && target.documentKey === this.selectedDate) {
        this.editor.command('focus').catch(() => {});
      }
    }).catch(() => {});
  }

  private imageUpload(): LogImageUpload {
    return new LogImageUpload(this.getUIContext().getHostContext() as common.UIAbilityContext);
  }

  private async insertImages(): Promise<void> {
    if (!this.day || this.imageBusy || this.linkOpen || this.backupOpen) return;
    this.moreOpen = false;
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    const uploader = this.imageUpload();
    let target: EditorSnapshot | undefined = undefined;
    let files: ApiUploadFile[] = [];
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      for (let attempt = 0; attempt < 50 && this.editor.loadedDocumentKey !== date; attempt += 1) {
        if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (this.editor.loadedDocumentKey !== date) throw new Error('编辑器尚未就绪，请稍后重试');
      target = await this.editor.command('capture');
      files = await uploader.pick();
      if (!files.length || lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const before = target.text.slice(0, target.from);
      const after = target.text.slice(target.to);
      const prefix = before ? (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') : '';
      const suffix = after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : '';
      await this.editor.insert(target, `${prefix}${markdown}${suffix}`);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '图片插入失败';
    } finally {
      uploader.clear(files);
      if (target) this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private async receiveImages(target: EditorSnapshot, images: EditorImageData[]): Promise<void> {
    if (this.imageBusy || this.linkOpen || this.backupOpen || !this.day || target.documentKey !== this.selectedDate) {
      this.editor.release(target).catch(() => {});
      return;
    }
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    const uploader = this.imageUpload();
    let files: ApiUploadFile[] = [];
    try {
      files = await uploader.paste(images);
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const before = target.text.slice(0, target.from);
      const after = target.text.slice(target.to);
      const prefix = before ? (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') : '';
      const suffix = after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : '';
      await this.editor.insert(target, `${prefix}${markdown}${suffix}`);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '图片粘贴失败';
    } finally {
      uploader.clear(files);
      this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private exportName(scope: string, date: string): string {
    if (scope === 'day') return `${date}.zip`;
    if (scope === 'file') return `${date.slice(0, 7)}_学习日志.zip`;
    const today = new Date();
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `study-log-export-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}.zip`;
  }

  private async confirmSavedExport(): Promise<boolean> {
    if (this.day && this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.selectedDate) return false;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
    }
    if (!this.dirty) return true;
    return new Promise<boolean>((resolve) => {
      AlertDialog.show({ title: '导出已保存内容？',
        message: '当前编辑器有未保存修改，导出内容将以已保存的 Markdown 文件为准。',
        primaryButton: { value: '取消', action: () => resolve(false) },
        secondaryButton: { value: '继续导出', action: () => resolve(true) },
        cancel: () => resolve(false) });
    });
  }

  private async exportLogs(scope: string): Promise<void> {
    this.moreOpen = false;
    this.exportMenuOpen = false;
    if (this.exportBusy || this.imageBusy || this.saving || this.deleting || this.linkOpen ||
      (scope !== 'all' && !this.selectedDate)) return;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    this.exportBusy = true;
    this.saveError = '';
    try {
      if (!await this.confirmSavedExport() || lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const query = scope === 'all' ? '' : `&date=${encodeURIComponent(date)}`;
      const data = await apiClient.download(`/export?scope=${scope}${query}`);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      await saveExport(this.getUIContext().getHostContext() as common.UIAbilityContext,
        this.exportName(scope, date), data,
        () => lifecycle === this.lifecycle && date === this.selectedDate);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '日志导出失败';
    } finally {
      if (lifecycle === this.lifecycle) this.exportBusy = false;
    }
  }

  private refreshLog(): void {
    this.moreOpen = false;
    if (this.day && this.selectedDate) this.confirmDiscard(() => this.loadDay(this.selectedDate));
    else if (this.month) this.loadDays(this.month);
    else this.loadMonths();
  }

  private changeSearch(query: string): void {
    this.searchQuery = query;
    this.searchRevision++;
    this.searchLoading = false;
    this.searchSubmitted = false;
    this.searchResults = [];
    this.searchError = '';
  }

  private closeSearch(): void {
    this.searchOpen = false;
    this.searchRevision++;
    this.searchLoading = false;
  }

  private showSearchHistory(): boolean {
    return this.rememberSearch && !this.searchQuery.trim() && !this.searchSubmitted &&
      !this.searchLoading && this.searchHistory.length > 0;
  }

  private updateSearchHistory(items: string[]): void {
    this.searchHistory = items;
    this.searchHistoryStore.save(items);
  }

  private selectSearchHistory(query: string): void {
    this.changeSearch(query);
    this.searchLogs();
  }

  private async searchLogs(): Promise<void> {
    const query = this.searchQuery.trim();
    if (!query || this.searchLoading) return;
    if (this.rememberSearch) this.updateSearchHistory(
      [query, ...this.searchHistory.filter((item: string) => item !== query)].slice(0, 8));
    const revision = ++this.searchRevision;
    const lifecycle = this.lifecycle;
    this.searchLoading = true;
    this.searchSubmitted = true;
    this.searchError = '';
    this.searchResults = [];
    try {
      const response = await this.searches.search(query, this.searchHeadingsOnly, this.searchIgnoreCase);
      if (revision !== this.searchRevision || lifecycle !== this.lifecycle || !this.searchOpen) return;
      if (!Array.isArray(response.results)) throw new Error('搜索响应格式异常');
      this.searchResults = response.results;
    } catch (error) {
      if (revision === this.searchRevision && lifecycle === this.lifecycle && this.searchOpen) {
        this.searchError = error instanceof Error ? error.message : '搜索失败，请重试';
      }
    } finally {
      if (revision === this.searchRevision && lifecycle === this.lifecycle) this.searchLoading = false;
    }
  }

  private selectSearchResult(result: LogSearchResult): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return;
    const query = this.searchQuery.trim();
    const heading = (result.matches[0] || '').replace(/^#{1,6}\s+/, '').replace(/^\d+\.\s+/, '').trim();
    const navigate = (): void => {
      this.closeSearch();
      this.openInternalLink(result.date, result.headings.includes(heading) ? heading : '', 'search', query);
    };
    if (result.date === this.selectedDate) navigate();
    else this.confirmDiscard(navigate);
  }

  @Builder
  private desktopSearchResults() {
    if (this.searchOpen && (this.showSearchHistory() || this.searchSubmitted || this.searchLoading || this.searchError)) {
      Column({ space: 4 }) {
        if (this.showSearchHistory()) {
          SearchHistoryList({ searchHistory: this.searchHistory,
            listHeight: Math.min(320, this.searchHistory.length * 40 + 32),
            onSelect: (query: string) => this.selectSearchHistory(query),
            onRemove: (query: string) => this.updateSearchHistory(
              this.searchHistory.filter((entry: string) => entry !== query)),
            onClear: () => this.updateSearchHistory([]) })
        } else if (this.searchLoading) {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.primary'))
            Text('正在搜索').fontSize(12).fontColor($r('app.color.muted'))
          }.width('100%').height(44).padding({ left: 12 })
        } else if (this.searchError) {
          Row() {
            Text(this.searchError).fontSize(12).fontColor($r('app.color.error')).layoutWeight(1)
            Button('重试').fontSize(12).onClick(() => this.searchLogs())
          }.width('100%').padding(10)
        } else if (!this.searchResults.length) {
          Text('未找到匹配内容').fontSize(12).fontColor($r('app.color.muted'))
            .width('100%').padding(12)
        } else {
          List({ space: 4 }) {
            ForEach(this.searchResults, (result: LogSearchResult) => {
              ListItem() {
                Button({ type: ButtonType.Normal }) {
                  Column({ space: 3 }) {
                    Text(result.date).fontSize(13).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.ink')).width('100%')
                    Text(result.matches[0] || result.headings[0] || '')
                      .fontSize(12).fontColor($r('app.color.muted')).maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                  }.alignItems(HorizontalAlign.Start).width('100%')
                }.width('100%').padding(10)
                  .backgroundColor($r('app.color.surface_soft')).borderRadius(8)
                  .onClick(() => this.selectSearchResult(result))
              }
            }, (result: LogSearchResult) => result.date)
          }.width('100%').height(Math.min(420, this.searchResults.length * 68)).scrollBar(BarState.Off)
        }
      }.width(384).height(this.showSearchHistory() ? Math.min(320, this.searchHistory.length * 40 + 32) + 16 :
        this.searchLoading || this.searchError || !this.searchResults.length ? 60 :
        Math.min(420, this.searchResults.length * 68) + 16).padding(8)
        .position({ x: 0, y: 50 })
        .backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(12)
        .shadow({ radius: 18, color: $r('app.color.popover_shadow'), offsetY: 6 })
        .zIndex(40)
    }
  }

  private async confirmDelete(): Promise<void> {
    if (!this.day?.exists || !this.day.version || this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) return;
    this.moreOpen = false;
    const date = this.day.date;
    const version = this.day.version;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== date || this.day?.version !== version) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    AlertDialog.show({
      message: this.dirty ? `确认删除 ${date} 日块？当前有未保存修改，删除会保留写入前备份。` :
        `确认删除 ${date} 日块？此操作会保留写入前备份。`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'),
        action: () => { if (this.day?.date === date && this.day.version === version) this.deleteDay(date, version); } }
    });
  }

  private async deleteDay(date: string, version: string): Promise<void> {
    if (this.deleting || this.saving || this.backupOpen || this.linkOpen) return;
    const lifecycle = this.lifecycle;
    const revision = this.dayRevision;
    this.deleting = true;
    this.saveError = '';
    try {
      const response = await this.writes.delete({ date, baseVersion: version });
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision || this.day?.date !== date) return;
      if (!response.day || response.day.date !== date || response.day.exists) throw new Error('删除响应格式异常');
      this.day = response.day;
      const body = this.bodyFromDay(response.day);
      this.savedText = body;
      this.draftBaseVersion = response.day.version;
      this.draftText = body;
      this.editorInitialText = body;
      this.previewText = body;
      this.dirty = false;
      this.reportDraft();
      this.sourceMode = false;
      this.splitMode = false;
      this.reads.invalidate();
      this.refreshNavigation(date);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未删除。请刷新后核对。' : error instanceof Error ? error.message : '删除失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.deleting = false;
    }
  }

  private async loadMonths(): Promise<void> {
    const lifecycle = this.lifecycle;
    this.monthsLoading = true;
    this.readFailed = false;
    this.errorMessage = '';
    try {
      const response = await this.reads.months();
      if (lifecycle !== this.lifecycle) return;
      if (!Array.isArray(response.months)) throw new Error('月份响应格式异常');
      this.months = response.months;
      const restoreDate = this.initialDraft?.namespace === activeInstance.namespace ? this.initialDraft.date : '';
      if (restoreDate || response.months.length > 0) {
        await this.loadDays(restoreDate ? restoreDate.slice(0, 7) : response.months[0].id, restoreDate);
      }
      else { this.month = ''; this.days = []; this.day = undefined; this.selectedDate = ''; }
    } catch (error) {
      if (lifecycle === this.lifecycle) {
        this.readFailed = true;
        this.errorMessage = this.message(error as Error);
        this.retryRead = async () => this.loadMonths();
      }
    } finally {
      if (lifecycle === this.lifecycle) this.monthsLoading = false;
    }
  }

  private async loadDays(month: string, targetDate: string = ''): Promise<void> {
    const lifecycle = this.lifecycle;
    const revision = ++this.listRevision;
    this.dayRevision++;
    await this.coverLogDocument();
    if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
    const previousMonth = this.month;
    const previousDays = this.days;
    this.month = month;
    this.daysLoading = true;
    this.readFailed = false;
    this.navigationError = '';
    try {
      const response = await this.reads.days(month);
      if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
      if (!Array.isArray(response.days)) throw new Error('日期响应格式异常');
      this.days = response.days;
      if (targetDate) await this.loadDay(targetDate);
      else if (response.days.length > 0) await this.loadDay(response.days[0].date);
      else {
        this.day = undefined;
        this.selectedDate = '';
        this.readerReady = false;
        this.renderedPreviewDate = '';
        this.workspaceTransition.finish('document');
      }
      if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
      if (this.errorMessage && this.day) {
        this.month = previousMonth;
        this.days = previousDays;
      }
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.listRevision) {
        this.month = previousMonth;
        this.navigationError = this.message(error as Error);
        this.readFailed = true;
        this.errorMessage = this.navigationError;
        this.retryRead = async () => this.loadDays(month, targetDate);
        this.workspaceTransition.finish('document');
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.listRevision) this.daysLoading = false;
    }
  }

  private async loadDay(date: string, heading: string = '', headingIndex: number = -1): Promise<void> {
    this.closeFavoriteFeedback();
    this.favoriteGroupDialogOpen = false;
    const lifecycle = this.lifecycle;
    const revision = ++this.dayRevision;
    await this.coverLogDocument();
    if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
    this.dayLoading = true;
    this.readFailed = false;
    this.errorMessage = '';
    try {
      const response = await this.reads.day(date);
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      if (!response.day || response.day.date !== date || typeof response.day.content !== 'string') {
        throw new Error('日块响应格式异常');
      }
      const body = this.bodyFromDay(response.day);
      const restore = !this.restoredDraftApplied ? restoredLogDraft(this.initialDraft,
        activeInstance.namespace, date, body, response.day.version) : undefined;
      const nextText = restore ? restore.text : body;
      const changed = this.day?.date !== date || this.previewText !== nextText;
      this.day = response.day;
      this.selectedDate = date;
      if (changed) {
        this.readerReady = false;
        this.renderedPreviewDate = '';
        this.editorReady = false;
      }
      this.previewRestoreOffset = this.previewScrollOffsets[date] || 0;
      this.previewOffset = this.previewRestoreOffset;
      this.activeOutlineIndex = Math.max(0, headingIndex);
      if (this.initialDraft?.namespace === activeInstance.namespace && this.initialDraft.date === date) {
        this.restoredDraftApplied = true;
      }
      this.savedText = body;
      this.draftBaseVersion = restore ? this.initialDraft!.baseVersion : response.day.version;
      this.draftText = nextText;
      this.editorInitialText = this.draftText;
      this.previewText = this.draftText;
      this.dirty = this.draftText !== body;
      this.reportDraft();
      this.saveError = restore?.conflict ?
        '已恢复本机草稿，但服务器版本已变化。请核对后复制草稿并刷新，保存不会覆盖新版本。' : '';
      this.targetHeading = heading;
      this.targetHeadingIndex = headingIndex;
      if (heading) this.targetRevision++;
      this.closeNavigation();
      if (!changed) this.workspaceTransition.finish('document');
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) {
        this.readFailed = true;
        this.errorMessage = this.message(error as Error);
        this.retryRead = async () => this.loadDay(date, heading, headingIndex);
        this.workspaceTransition.finish('document');
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) {
        this.dayLoading = false;
        if ((this.sourceMode || this.splitMode && !this.isWide()) &&
          this.editor.loadedDocumentKey === date) {
          this.getUIContext().postFrameCallback(new FrameAction(() => {
            if (lifecycle === this.lifecycle && revision === this.dayRevision) {
              this.workspaceTransition.finish('document');
            }
          }));
        }
      }
    }
  }

  private async coverLogDocument(): Promise<void> {
    if ((this.workspaceTransition.waitingKind && this.workspaceTransition.waitingKind !== 'document') ||
      (this.workspaceTransition.kind && this.workspaceTransition.kind !== 'document')) {
      this.workspaceTransition.clear();
    }
    await this.workspaceTransition.cover('document');
  }

  private async openInternalLink(date: string, heading: string, kind: string = 'internal', query: string = ''): Promise<void> {
    this.targetKind = kind;
    this.targetQuery = query;
    if (date.slice(0, 7) !== this.month) {
      await this.loadDays(date.slice(0, 7), date);
      if (this.day?.date !== date) return;
    } else if (date !== this.selectedDate) {
      await this.loadDay(date);
      if (this.day?.date !== date) return;
    }
    this.targetHeading = heading;
    this.targetHeadingIndex = -1;
    this.targetRevision++;
  }

  private calendarDate(value: Date): string {
    return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
  }

  private openCalendar(mode: string): void {
    this.calendarMode = mode;
    if (!this.newLogDate) this.newLogDate = this.calendarDate(new Date());
    this.calendarMonth = (mode === 'jump' ? this.selectedDate || this.newLogDate : this.newLogDate).slice(0, 7);
    this.calendarOpen = true;
    this.loadCalendar();
  }

  private async loadCalendar(): Promise<void> {
    const revision = ++this.calendarRevision;
    this.calendarLoading = true;
    this.calendarError = false;
    this.calendarDates = [];
    try {
      const response = await this.reads.days(this.calendarMonth);
      if (revision === this.calendarRevision) this.calendarDates = response.days.map((day: DaySummary) => day.date);
    } catch (_) {
      if (revision === this.calendarRevision) this.calendarError = true;
    } finally {
      if (revision === this.calendarRevision) this.calendarLoading = false;
    }
  }

  private shiftCalendar(offset: number): void {
    const parts = this.calendarMonth.split('-');
    this.calendarMonth = this.calendarDate(new Date(Number(parts[0]), Number(parts[1]) - 1 + offset, 1)).slice(0, 7);
    this.loadCalendar();
  }

  private calendarCells(): string[] {
    if (!this.calendarMonth) return [];
    const parts = this.calendarMonth.split('-');
    const first = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    const count = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    const cells: string[] = [];
    for (let index = 0; index < (first.getDay() + 6) % 7; index++) cells.push('');
    for (let day = 1; day <= count; day++) cells.push(`${this.calendarMonth}-${day.toString().padStart(2, '0')}`);
    return cells;
  }

  private canSelectCalendarDate(date: string): boolean {
    return !!date && date <= this.calendarDate(new Date()) &&
      (this.calendarMode === 'create' || (!this.calendarLoading && !this.calendarError && this.calendarDates.includes(date)));
  }

  private selectCalendarDate(date: string): void {
    if (!this.canSelectCalendarDate(date)) return;
    this.calendarOpen = false;
    if (this.calendarMode === 'jump') this.confirmDiscard(() => this.openDate(date, false));
    else this.newLogDate = date;
  }

  private async openDate(date: string, edit: boolean): Promise<void> {
    if (date.slice(0, 7) === this.month) await this.loadDay(date);
    else await this.loadDays(date.slice(0, 7), date);
    if (edit && this.day?.date === date) { this.sourceMode = true; this.splitMode = false; }
  }

  private openNewLog(date: string): void {
    this.calendarOpen = false;
    this.confirmDiscard(() => this.openDate(date, true));
  }

  @Builder
  private logCalendar() {
    Column({ space: 8 }) {
      Text(this.calendarMode === 'jump' ? '跳转到日期' : '选择新建日期')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
      Row() {
        Button('‹', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .accessibilityText('上一个月').onClick(() => this.shiftCalendar(-1))
        Text(this.calendarMonth).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Center)
        Button('›', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .enabled(this.calendarMonth < this.calendarDate(new Date()).slice(0, 7))
          .accessibilityText('下一个月').onClick(() => this.shiftCalendar(1))
      }.width('100%')
      Row() {
        ForEach(['一', '二', '三', '四', '五', '六', '日'], (day: string) => {
          Text(day).width('14.2857%').textAlign(TextAlign.Center).fontSize(12).fontColor($r('app.color.muted'))
        })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.calendarCells(), (date: string, index: number) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 2 }) {
              Text(date ? Number(date.slice(-2)).toString() : '').fontSize(13)
                .fontColor(this.canSelectCalendarDate(date) ? $r('app.color.ink') : $r('app.color.muted_soft'))
              Circle().width(3).height(3).fill(this.calendarDates.includes(date) ? $r('app.color.primary') : Color.Transparent)
            }
          }
          .id(`log_calendar_day_${date || index}`).width('14.2857%').height(36).padding(0)
          .backgroundColor(date && date === (this.calendarMode === 'jump' ? this.selectedDate : this.newLogDate) ?
            $r('app.color.surface_card') : Color.Transparent)
          .borderRadius(6).enabled(this.canSelectCalendarDate(date))
          .accessibilityText(date).onClick(() => this.selectCalendarDate(date))
        }, (date: string, index: number) => `${date}:${index}`)
      }.width('100%')
      if (this.calendarError) {
        Button('读取失败，点击重试', { type: ButtonType.Normal }).fontSize(12)
          .fontColor($r('app.color.muted')).backgroundColor(Color.Transparent).onClick(() => this.loadCalendar())
      } else {
        Text(this.calendarLoading ? '正在读取日志日期…' :
          this.calendarMode === 'jump' ? '有记录的日期可直接跳转' : '选定日期后，点击“新建”打开日块')
          .fontSize(12).fontColor($r('app.color.muted'))
      }
    }.width(280).padding(14)
  }

  @Builder
  private dateActions() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([$r('app.color.ink')])
          Text('今天').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.justifyContent(FlexAlign.Center)
      }
      .width('100%').height(40).padding(0).margin({ bottom: 8 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      .onClick(() => this.openNewLog(this.calendarDate(new Date())))
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.ink')])
            Text(this.newLogDate || this.calendarDate(new Date())).fontSize(13)
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          }.justifyContent(FlexAlign.Center)
        }
        .layoutWeight(1).height(40).padding(0).backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .id('log_create_date_picker').accessibilityText('选择新建日期')
        .onClick(() => this.openCalendar('create'))
        .bindPopup(this.calendarOpen && this.calendarMode === 'create', {
          builder: this.logCalendar(), placement: Placement.Bottom, enableArrow: false,
          popupColor: $r('app.color.canvas'), radius: 8,
          onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'create') this.calendarOpen = false; }
        })
        Button('+ 新建', { type: ButtonType.Normal }).height(40).padding({ left: 10, right: 10 })
          .fontSize(13).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .id('log_create_date_submit').onClick(() => this.openNewLog(this.newLogDate || this.calendarDate(new Date())))
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private jumpDatePicker() {
    Button({ type: ButtonType.Normal }) {
      SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
    }.width(28).height(28).padding(0).backgroundColor(Color.Transparent)
      .id('log_jump_date_picker').accessibilityText('跳转到指定日期')
      .onClick(() => this.openCalendar('jump'))
      .bindPopup(this.calendarOpen && this.calendarMode === 'jump', {
        builder: this.logCalendar(), placement: Placement.BottomRight, enableArrow: false,
        popupColor: $r('app.color.canvas'), radius: 8,
        onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'jump') this.calendarOpen = false; }
      })
  }

  private openHeading(day: DaySummary, heading: string, index: number): void {
    if (this.day?.date === day.date) {
      this.targetHeading = heading;
      this.targetHeadingIndex = index;
      this.targetRevision++;
      this.closeNavigation();
    } else this.confirmDiscard(() => this.loadDay(day.date, heading, index));
  }

  private adjacentDay(offset: number): string {
    const index = this.days.findIndex((item: DaySummary) => item.date === this.selectedDate);
    if (index < 0) return '';
    return this.days[index + offset]?.date || '';
  }

  private navigateDay(offset: number): void {
    const date = this.adjacentDay(offset);
    if (date) this.confirmDiscard(() => this.loadDay(date));
  }

  @Builder
  private desktopAdjacentButton(label: string, direction: number) {
    Button({ type: ButtonType.Normal }) {
      if (this.logsReadingMode || this.showToolbarLabels('navigation')) {
        Row({ space: 4 }) {
          if (direction > 0) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(12).fontColor([$r('app.color.body')])
          }
          Text(label).fontSize(12).fontColor($r('app.color.body'))
          if (direction < 0) {
            SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([$r('app.color.body')])
          }
        }.justifyContent(FlexAlign.Center)
      } else {
        SymbolGlyph(direction > 0 ? $r('sys.symbol.chevron_left') : $r('sys.symbol.chevron_right'))
          .fontSize(16).fontColor([$r('app.color.body')])
      }
    }.id(direction > 0 ? 'log_previous_day' : 'log_next_day')
      .width(this.logsReadingMode || this.showToolbarLabels('navigation') ? undefined : 32)
      .height(this.logsReadingMode ? 34 : 32)
      .padding({ left: this.logsReadingMode ? 10 : this.showToolbarLabels('navigation') ? 12 : 0,
        right: this.logsReadingMode ? 10 : this.showToolbarLabels('navigation') ? 12 : 0 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(7)
      .accessibilityText(label).enabled(this.adjacentDay(direction).length > 0)
      .onClick(() => this.navigateDay(direction))
  }

  @Builder
  private navigation() {
    Column() {
      if (this.isWide()) {
        Row({ space: 6 }) {
          Image($r('app.media.tab_file_text_active')).width(19).height(19).objectFit(ImageFit.Contain)
          Text('学习日志').fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.body_strong')).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(16).fontColor([$r('app.color.body')])
          }.width(34).height(34).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
            .id('sidebar_collapse').accessibilityText('折叠侧栏').bindTips('折叠侧栏', WORKSPACE_TIPS)
            .onClick(() => this.setDesktopNavigationCollapsed(true))
        }.width('100%').height(52).padding({ left: 16, right: 10 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
      }
      LogNavigation({ navigationMonths: this.months, navigationDays: this.days,
        navigationMonth: this.month, requestedDate: this.selectedDate,
        logNavigationScroller: this.logNavigationScroller,
        navigationMonthsExpanded: this.navigationMonthsExpanded,
        navigationDayQuery: this.navigationDayQuery,
        navigationLoading: this.monthsLoading || this.daysLoading,
        navigationError: this.navigationError,
        dateActions: (): void => this.dateActions(),
        jumpDatePicker: (): void => this.jumpDatePicker(),
        onMonth: (month: string) => { if (month !== this.month) this.confirmDiscard(() => this.loadDays(month)); },
        onDay: (date: string) => {
          if (date !== this.selectedDate || this.dayLoading) this.confirmDiscard(() => this.loadDay(date));
        },
        onHeading: (day: DaySummary, heading: string, index: number) => this.openHeading(day, heading, index),
        onQuery: (query: string) => this.navigationDayQuery = query,
        onToggleMonths: () => expandSection(this.getUIContext(), () => {
          this.navigationMonthsExpanded = !this.navigationMonthsExpanded;
        }),
        onRetry: () => this.month ? this.loadDays(this.month) : this.loadMonths() })
    }
    .width('100%').height('100%')
    .backgroundColor(this.isWide() ? $r('app.color.surface_soft') : $r('app.color.canvas'))
  }

  private setDesktopNavigationCollapsed(collapsed: boolean, section: number = -1): void {
    if (collapsed === this.isDesktopNavigationCollapsed() || this.sidebarAnimating || this.aiAnimating) return;
    const revision = ++this.sidebarMotionRevision;
    const origin = this.isDesktopNavigationCollapsed() ? 0 : 1;
    const target = collapsed ? 0 : 1;
    this.sidebarExpansion = origin;
    this.sidebarAnimating = true;
    this.railPopover = '';
    const module = this.selectedTab();
    this.collapsedModules = this.collapsedModules.map((value: boolean, index: number) => index === module ? collapsed : value);
    workspacePreferences.set(`sidebarCollapsed${module}`, collapsed)
      .catch(() => appFeedback.show('侧栏状态保存失败', 'error'));
    const targetNavigationWidth = collapsed ? 52 :
      (this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220);
    const toolbarWidths: number[][] = module === 0 ? this.beginToolbarMotion(this.aiAvailableWidth - targetNavigationWidth -
      (52 + (this.aiPanelWidth - 52) * (1 - this.aiOffset / 420))) : [];
    const started = Date.now();
    const step = (): void => {
      if (revision !== this.sidebarMotionRevision) return;
      const progress = Math.min(1, (Date.now() - started) / 240);
      const eased = progress * progress * (3 - 2 * progress);
      this.sidebarExpansion = origin + (target - origin) * eased;
      if (toolbarWidths.length) this.advanceToolbarMotion(toolbarWidths, eased);
      if (progress < 1) this.getUIContext().postFrameCallback(new FrameAction(step));
      else {
        this.sidebarAnimating = false;
        this.getUIContext().postFrameCallback(new FrameAction(() => {
          if (revision === this.sidebarMotionRevision && !this.aiAnimating) this.finishToolbarMotion();
        }));
        if (!collapsed && section >= 0) this.logNavigationScroller.scrollToIndex(section, false, ScrollAlign.START);
      }
    };
    this.getUIContext().postFrameCallback(new FrameAction(step));
  }

  private expandNavigation(section: number = -1): void {
    this.setDesktopNavigationCollapsed(false, section);
  }

  private desktopNavigationWidth(): number {
    const full = this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220;
    return 52 + (full - 52) * (this.sidebarAnimating ? this.sidebarExpansion :
      (this.isDesktopNavigationCollapsed() ? 0 : 1));
  }

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
        () => { this.railPopover = ''; this.expandNavigation(); })
      if (this.qaOpen) {
        this.navigationRailButton('new_question', $r('app.media.rail_square_pen'), '新建问答',
          () => { this.railPopover = ''; this.switchQaSession(''); }, false, !this.qaBusy)
        this.navigationRailButton('search', $r('app.media.rail_search'), '搜索历史',
          () => this.railPopover = this.railPopover === 'search' ? '' : 'search', this.railPopover === 'search')
        this.navigationRailButton('recent', $r('app.media.rail_message_square_text'), '最近问答',
          () => { this.qaQuery = ''; this.railPopover = this.railPopover === 'recent' ? '' : 'recent'; },
          this.railPopover === 'recent')
      } else if (this.notesOpen) {
        this.navigationRailButton('new_note', $r('app.media.rail_plus'), '新建随记',
          () => { this.railPopover = ''; this.noteNewRevision++; }, false, !this.notesBusy)
        this.navigationRailButton('tags', $r('app.media.rail_tag'), '年份和标签',
          () => this.railPopover = this.railPopover === 'tags' ? '' : 'tags', this.railPopover === 'tags')
      } else if (this.favoritesOpen) {
        this.navigationRailButton('favorite_filters', $r('app.media.tab_star'), '筛选收藏',
          () => this.railPopover = this.railPopover === 'favorite_filters' ? '' : 'favorite_filters',
          this.railPopover === 'favorite_filters')
      } else if (this.statsOpen) {
        this.navigationRailButton('stats_months', $r('app.media.rail_calendar_days'), '选择统计月份',
          () => this.railPopover = this.railPopover === 'stats_months' ? '' : 'stats_months',
          this.railPopover === 'stats_months')
      } else {
      this.navigationRailButton('months', $r('app.media.rail_calendar_days'), '展开月份列表',
        () => this.expandNavigation(0))
      this.navigationRailButton('dates', $r('app.media.rail_file_text'), '展开日期列表',
        () => this.expandNavigation(2))
      this.navigationRailButton('today', $r('app.media.rail_plus'), '新建今日日志',
        () => this.openNewLog(this.calendarDate(new Date())))
      }
    }.id('sidebar_rail').width('100%').height('100%')
      .alignItems(HorizontalAlign.Center).padding({ top: 14, bottom: 14 })
  }

  @Builder
  private moduleNavigationContent(popover: boolean = false) {
    if (this.qaOpen) {
      QaNavigation({ qaRailPopover: popover ? this.railPopover : '', moduleFrameHeight: this.moduleFrameHeight,
                    qaSessions: this.qaNavigation.qaSessions, qaSessionQuery: this.qaQuery,
                    qaActiveSessionId: this.qaSessionId, qaBusy: this.qaBusy,
                    qaNavigationLoading: this.qaNavigation.qaNavigationLoading,
                    qaNavigationError: this.qaNavigation.qaNavigationError,
                    qaRenameId: this.qaNavigation.qaRenameId,
                    qaRenameTitle: this.qaNavigation.qaRenameTitle,
                    qaMenuId: this.qaNavigation.qaMenuId,
                    onQuery: (query: string) => this.qaQuery = query,
                    onSession: (id: string) => this.switchQaSession(id),
                    onMenu: (id: string) => this.qaNavigation.qaMenuId = id,
                    onStartRename: (session: RagSessionSummary) => {
                      this.qaNavigation.qaRenameId = session.id;
                      this.qaNavigation.qaRenameTitle = session.title;
                    },
                    onRenameTitle: (title: string) => this.qaNavigation.qaRenameTitle = title,
                    onCommitRename: () => this.qaNavigation.commitQaRename(),
                    onCancelRename: () => this.qaNavigation.qaRenameId = '',
                    onDelete: (session: RagSessionSummary) => this.confirmQaDelete(session),
                    onRetry: () => this.qaNavigation.loadQaNavigation() })
    } else if (this.notesOpen) {
      NotesNavigation({ filtersOnly: popover, noteYearFilter: this.noteYearFilter, noteTagFilter: this.noteTagFilter,
                    noteCount: this.noteCount, noteYears: this.noteYears, noteTags: this.noteTags,
                    noteEditorBusy: this.notesBusy,
                    onNew: () => { this.noteNewRevision++; this.railPopover = ''; },
                    onYear: (year: string) => { this.noteYearFilter = year; this.railPopover = ''; },
                    onTag: (tag: string) => { this.noteTagFilter = tag; this.railPopover = ''; } })
    } else if (this.favoritesOpen) {
      FavoritesNavigation({ data: this.favoritesData, wide: true,
                    onRetry: () => this.favoritesData.load() })
    } else if (this.statsOpen) {
      StatsNavigation({ monthsOnly: false, onTaxonomy: () => this.openTaxonomy(), statsMonths: this.statsMonths,
                    statsMonth: this.statsMonth, statsMonthsLoading: this.statsMonthsLoading,
                    statsMonthsError: this.statsMonthsError,
                    onMonth: (month: string) => {
                      this.statsMonth = month;
                      this.statsMonthRevision++; this.railPopover = '';
                    },
                    onRetry: () => this.statsRefreshRevision++ })
    } else { this.navigation() }
  }

  private async refreshNavigationLists(): Promise<void> {
    const tab = this.selectedTab();
    const instance = activeInstance.revision;
    const lifecycle = this.lifecycle;
    const month = this.month || this.selectedDate.slice(0, 7);
    const date = this.selectedDate;
    const months = this.months;
    const days = this.days;
    const years = this.noteYears;
    const qa = this.qaNavigation.qaSessions;
    const stats = this.statsMonths;
    const favorites = this.favoritesData.favorites;
    const groups = this.favoritesData.groups;
    await this.navigationRefresh.refresh(tab, month, () => {
      if (instance !== activeInstance.revision || lifecycle !== this.lifecycle || this.selectedTab() !== tab) return false;
      if (tab === 0) return date === this.selectedDate && month === (this.month || this.selectedDate.slice(0, 7)) &&
        months === this.months && days === this.days;
      if (tab === 1) return years === this.noteYears;
      if (tab === 2) return favorites === this.favoritesData.favorites && groups === this.favoritesData.groups &&
        !this.favoritesData.loading && !this.favoritesData.groupSaving && !this.favoritesData.groupUpdating &&
        !this.favoritesData.groupActionBusy;
      if (tab === 3) return qa === this.qaNavigation.qaSessions && !this.qaNavigation.qaNavigationLoading;
      return stats === this.statsMonths;
    }, (snapshot: NavigationSnapshot) => {
      if (tab === 0 && snapshot.months) {
        this.months = snapshot.months.months;
        if (snapshot.days) this.days = snapshot.days.days;
        this.navigationError = '';
      }
      if (snapshot.notes) {
        this.noteYears = snapshot.notes.years;
        this.noteTags = snapshot.notes.tags;
        this.noteCount = snapshot.notes.notes.length;
      }
      if (snapshot.favorites) {
        this.favoritesData.favorites = snapshot.favorites.favorites;
        this.favoritesData.groups = snapshot.favorites.groups;
        this.favoritesData.loadFailed = false;
        this.favoritesData.errorMessage = '';
      }
      if (snapshot.qa) this.qaNavigation.acceptQaNavigation(snapshot.qa.sessions);
      if (tab === 4 && snapshot.months) {
        this.statsMonths = snapshot.months.months;
        this.statsMonthsError = '';
      }
    });
  }

  @Builder
  private refreshableNavigationContent() {
    NavigationRefresh({ onRefresh: (): Promise<void> => this.refreshNavigationLists(),
      content: (): void => this.moduleNavigationContent() })
  }

  @Builder
  private refreshableCompactNavigationContent() {
    NavigationRefresh({ onRefresh: (): Promise<void> => this.refreshNavigationLists(),
      content: (): void => this.compactNavigationContent() })
  }

  private hasNavigationFilters(): boolean {
    if (this.notesOpen) return this.noteYearFilter !== 'all' || this.noteTagFilter !== 'all';
    if (this.favoritesOpen) return this.favoritesData.selectedGroup !== 'all' || this.favoritesData.selectedMonth !== 'all';
    if (this.statsOpen) return this.statsMonths.length > 0 && this.statsMonth !== this.statsMonths[0].id;
    return false;
  }

  private resetNavigationFilters(): void {
    if (this.notesOpen) { this.noteYearFilter = 'all'; this.noteTagFilter = 'all'; }
    else if (this.favoritesOpen) { this.favoritesData.selectGroup('all'); this.favoritesData.selectMonth('all'); }
    else if (this.statsOpen && this.statsMonths.length > 0) {
      this.statsMonth = this.statsMonths[0].id; this.statsMonthRevision++;
    }
  }

  @Builder
  private navigationFilterReset(id: string = 'navigation_reset_filters') {
    if (this.notesOpen || this.favoritesOpen || this.statsOpen) {
      Button('重置筛选', { type: ButtonType.Normal }).id(id).width(64).height(34).padding(0)
        .fontSize(12).fontColor($r('app.color.muted')).backgroundColor(Color.Transparent).borderRadius(8)
        .visibility(this.hasNavigationFilters() ? Visibility.Visible : Visibility.Hidden)
        .onClick(() => this.resetNavigationFilters())
    }
  }

  @Builder
  private moduleNavigationHeader() {
    Row({ space: 6 }) {
      Image(this.notesOpen ? $r('app.media.tab_lightbulb_active') : this.favoritesOpen ?
        $r('app.media.tab_star_active') : this.qaOpen ? $r('app.media.rail_message_square_text') :
        $r('app.media.tab_chart_column')).width(19).height(19).objectFit(ImageFit.Contain)
      Text(this.notesOpen ? '随记' : this.favoritesOpen ? '收藏中心' : this.qaOpen ? '知识问答' : '学习统计')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong')).layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      this.navigationFilterReset()
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(16).fontColor([$r('app.color.body')])
      }.width(34).height(34).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
        .id('sidebar_collapse').accessibilityText('折叠侧栏').bindTips('折叠侧栏', WORKSPACE_TIPS)
        .onClick(() => this.setDesktopNavigationCollapsed(true))
    }.width('100%').height(52).padding({ left: 16, right: 10 })
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }

  @Builder
  private desktopNavigation() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        if (this.selectedTab() !== 0) this.moduleNavigationHeader()
        this.refreshableNavigationContent()
      }
        .width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
        .height('100%')
        .opacity(this.sidebarAnimating ? this.sidebarExpansion :
          (this.isDesktopNavigationCollapsed() ? 0 : 1))
        .visibility(!this.isDesktopNavigationCollapsed() || this.sidebarAnimating ?
          Visibility.Visible : Visibility.Hidden)
        .hitTestBehavior(this.isDesktopNavigationCollapsed() || this.sidebarAnimating ?
          HitTestMode.None : HitTestMode.Default)
        .accessibilityLevel(this.isDesktopNavigationCollapsed() ? 'no-hide-descendants' : 'auto')
      Column() { this.desktopNavigationRail() }.width(52).height('100%')
        .opacity(this.sidebarAnimating ? 1 - this.sidebarExpansion :
          (this.isDesktopNavigationCollapsed() ? 1 : 0))
        .visibility(this.isDesktopNavigationCollapsed() || this.sidebarAnimating ?
          Visibility.Visible : Visibility.Hidden)
        .hitTestBehavior(!this.isDesktopNavigationCollapsed() || this.sidebarAnimating ?
          HitTestMode.None : HitTestMode.Default)
        .accessibilityLevel(this.isDesktopNavigationCollapsed() ? 'auto' : 'no-hide-descendants')
    }.width(this.desktopNavigationWidth())
      .height('100%').backgroundColor($r('app.color.surface_soft'))
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
      .clip(this.sidebarAnimating)
      .border({ width: { right: 1 }, color: $r('app.color.hairline') })
      .id('desktop_navigation_frame').zIndex(this.railPopover ? 40 : 1)
      .onAreaChange((_: Area, area: Area) => this.moduleFrameHeight = Number(area.height))
  }

  @Builder
  private railPopoverPanel() {
    if (this.qaOpen) {
      this.moduleNavigationContent(true)
    } else {
      Column() {
        Row() {
        Text(this.notesOpen ? '年份和标签' : this.favoritesOpen ? '筛选收藏' : '统计月份')
          .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          .layoutWeight(1)
        this.navigationFilterReset('navigation_popover_reset_filters')
        }.width('100%').height(48).padding({ left: 14, right: 14 })
        this.moduleNavigationContent(true)
      }.width(280).height(Math.min(420, Math.max(180, this.moduleFrameHeight - 32)))
    }
  }

  @Builder
  private desktopMoreItem(icon: Resource, label: string, enabled: boolean, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Image(icon).width(16).height(16).colorFilter(iconTint($r('app.color.body')))
        Text(label).fontSize(13)
          .fontColor(label === '删除日块' ? $r('app.color.error') : $r('app.color.body'))
      }.width('100%')
    }.width('100%').height(40).padding({ left: 10, right: 10 }).borderRadius(8)
      .attributeModifier(new InteractiveSurface(Color.Transparent, this.hoveredMoreAction === label))
      .enabled(enabled).opacity(enabled ? 1 : 0.45)
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredMoreAction = hover ? label : ''))
      .onClick(() => { this.moreOpen = false; action(); })
  }

  @Builder
  private moreActions() {
    Column() {
      if ((this.sourceMode || this.splitMode) && !this.editorActionsInHeader()) {
        this.desktopMoreItem($r('app.media.link_2'), '内部链接', this.editorReady && !this.linkOpening,
          () => this.openLink())
        this.desktopMoreItem($r('app.media.search'), '查找替换', this.editorReady,
          () => this.editor.command('find'))
      }
      if (!this.documentActionsInHeader('refresh')) {
        this.desktopMoreItem($r('app.media.refresh_cw'), '刷新', !!this.selectedDate && !this.saving && !this.deleting,
          () => this.refreshLog())
      }
      this.desktopMoreItem($r('app.media.layout_list'), '大纲', this.outlineHeadings().length > 0,
        () => this.pendingOutlineOpen = true)
      this.desktopMoreItem($r('app.media.panel_right_open'), 'AI 工具', !!this.day,
        () => this.openAiTools())
      if (!this.editorActionsInHeader()) {
        this.desktopMoreItem($r('app.media.upload'), '插入图片', !!this.day && !this.imageBusy,
          () => this.insertImages())
        this.desktopMoreItem($r('app.media.eye'), '放弃修改', this.editorReady && this.dirty,
          () => this.discardDraft())
      }
      if (!this.documentActionsInHeader('backup')) {
        this.desktopMoreItem($r('app.media.database_backup'), '备份', !!this.day && !this.saving,
          () => this.backupOpen = true)
      }
      if (!this.documentActionsInHeader('delete')) {
        this.desktopMoreItem($r('app.media.trash_2'), '删除日块', !!this.day?.exists && !this.deleting,
          () => this.confirmDelete())
      }
      if (!this.documentActionsInHeader('export')) {
        Divider().color($r('app.color.hairline')).margin({ top: 4, bottom: 4 })
        this.desktopMoreItem($r('app.media.download'), '导出当前日块', !!this.day && !this.exportBusy,
          () => this.exportLogs('day'))
        this.desktopMoreItem($r('app.media.download'), '导出当前源文件', !!this.day && !this.exportBusy,
          () => this.exportLogs('file'))
        this.desktopMoreItem($r('app.media.download'), '导出全部日志', !this.exportBusy,
          () => this.exportLogs('all'))
      }
    }.width(220).padding(8)
      .onKeyEvent((event: KeyEvent) => {
        if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_ESCAPE) return false;
        this.moreOpen = false;
        return true;
      })
  }

  private async discardDraft(): Promise<void> {
    if (!this.day || !this.dirty || !this.editorReady) return;
    try {
      await this.editor.replace(this.savedText, true);
      this.draftText = this.savedText;
      this.previewText = this.savedText;
      this.dirty = false;
      this.reportDraft();
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : '放弃修改失败';
    }
  }

  @Builder
  private moreAction(icon: Resource, label: string, enabled: boolean, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 4 }) {
        Image(icon).width(18).height(18).objectFit(ImageFit.Contain)
          .colorFilter(iconTint(enabled ? $r('app.color.body') : $r('app.color.muted_soft')))
        Text(label).fontSize(12).fontWeight(FontWeight.Medium)
          .fontColor(enabled ? $r('app.color.body') : $r('app.color.muted_soft'))
      }.justifyContent(FlexAlign.Center)
    }.layoutWeight(1).height(58).padding(0)
      .backgroundColor($r('app.color.surface_soft'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(8).clip(true).enabled(enabled)
      .onClick(() => { this.moreOpen = false; action(); })
  }

  @Builder
  private exportAction(label: string, scope: string) {
    Button(label, { type: ButtonType.Normal })
      .layoutWeight(1).height(42).padding(0)
      .fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(8).clip(true)
      .enabled(!this.exportBusy && (scope === 'all' || !!this.selectedDate))
      .onClick(() => { this.moreOpen = false; this.exportLogs(scope); })
  }

  @Builder
  private compactMoreActionContent() {
    Column({ space: 10 }) {
      if (this.sourceMode || this.splitMode) {
        Row({ space: 8 }) {
          this.moreAction($r('app.media.link_2'), '内部链接', this.editorReady && !this.linkOpening,
            () => this.openLink())
          this.moreAction($r('app.media.search'), '查找替换', this.editorReady,
            () => this.editor.command('find'))
        }.width('100%')
      }
      Row({ space: 8 }) {
        this.moreAction($r('app.media.refresh_cw'), '刷新', !!this.selectedDate && !this.saving && !this.deleting,
          () => this.refreshLog())
        this.moreAction($r('app.media.layout_list'), '大纲', this.outlineHeadings().length > 0,
          () => this.pendingOutlineOpen = true)
        this.moreAction($r('app.media.panel_right_open'), 'AI 工具', !!this.day,
          () => this.openAiTools())
      }.width('100%')
      Row({ space: 8 }) {
        this.moreAction($r('app.media.upload'), '插入图片', !!this.day && !this.imageBusy,
          () => this.insertImages())
        this.moreAction($r('app.media.eye'), '放弃修改', this.editorReady && this.dirty,
          () => this.discardDraft())
        this.moreAction($r('app.media.database_backup'), '备份', !!this.day && !this.saving,
          () => this.backupOpen = true)
      }.width('100%')
      Button({ type: ButtonType.Normal }) {
        Row({ space: 7 }) {
          Image($r('app.media.trash_2')).width(16).height(16).colorFilter(iconTint($r('app.color.error')))
          Text('删除日块').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.error'))
        }.justifyContent(FlexAlign.Center)
      }.width('100%').height(42).padding(0)
        .backgroundColor($r('app.color.error_surface'))
        .border({ width: 1, color: $r('app.color.hairline') })
        .borderRadius(8).clip(true).enabled(!!this.day?.exists && !this.deleting)
        .onClick(() => { this.moreOpen = false; this.confirmDelete(); })
      Divider().strokeWidth(1).color($r('app.color.hairline')).margin({ top: 2 })
      Text('导出').width('100%').fontSize(13).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.muted'))
      Row({ space: 8 }) {
        this.exportAction('当前日块', 'day')
        this.exportAction('当前源文件', 'file')
        this.exportAction('全部日志', 'all')
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private compactMoreActionsPanel() {
    Column() {
      ActionPanelHeader({ title: '日志操作', showDragBar: true,
        closeLabel: '关闭日志操作', onClose: () => this.moreOpen = false })
        .margin({ bottom: 12 })
      this.compactMoreActionContent()
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 18 })
      .alignItems(HorizontalAlign.Center)
      .backgroundColor($r('app.color.canvas'))
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
  private topMoreActions() {
    Column() {
      this.desktopMoreItem($r('app.media.settings_2'), '设置', true,
        () => { this.topMoreOpen = false; this.onOpenSettings(); })
      this.desktopMoreItem($r('app.media.info'), '关于', true,
        () => { this.topMoreOpen = false; this.onOpenAbout(); })
      this.desktopMoreItem($r('app.media.circle_help'), '使用帮助', true,
        () => { this.topMoreOpen = false; this.onOpenHelp(); })
      this.desktopMoreItem($r('app.media.log_out'), '更换服务器', !this.backupOpen && !this.linkOpen,
        () => { this.topMoreOpen = false;
          this.confirmQaLeave(() => this.confirmNotesLeave(() => this.confirmDiscard(() => this.onChangeServer()))); })
    }.width(176).padding(6)
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
        this.confirmQaLeave(() => this.confirmNotesLeave(() => this.confirmDiscard(() => this.onChangeServer()))))
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 18 })
      .alignItems(HorizontalAlign.Center).backgroundColor($r('app.color.canvas'))
  }

  @Builder
  private compactNavigationContent() {
    if (this.notesOpen) {
      NotesNavigation({ noteYearFilter: this.noteYearFilter, noteTagFilter: this.noteTagFilter,
        noteCount: this.noteCount, noteYears: this.noteYears, noteTags: this.noteTags,
        noteEditorBusy: this.notesBusy,
        onNew: () => { this.noteNewRevision++; this.closeNavigation(); },
        onYear: (year: string) => { this.noteYearFilter = year; this.closeNavigation(); },
        onTag: (tag: string) => { this.noteTagFilter = tag; this.closeNavigation(); } })
    } else if (this.favoritesOpen) {
      FavoritesNavigation({ data: this.favoritesData, wide: false,
        onRetry: () => this.favoritesData.load() })
    } else if (this.qaOpen) {
      QaNavigation({ qaSessions: this.qaNavigation.qaSessions, qaSessionQuery: this.qaQuery,
        qaActiveSessionId: this.qaSessionId, qaBusy: this.qaBusy,
        qaNavigationLoading: this.qaNavigation.qaNavigationLoading,
        qaNavigationError: this.qaNavigation.qaNavigationError,
        qaRenameId: this.qaNavigation.qaRenameId, qaRenameTitle: this.qaNavigation.qaRenameTitle,
        qaMenuId: this.qaNavigation.qaMenuId,
        onQuery: (query: string) => this.qaQuery = query,
        onSession: (id: string) => this.switchQaSession(id),
        onMenu: (id: string) => this.qaNavigation.qaMenuId = id,
        onStartRename: (session: RagSessionSummary) => {
          this.qaNavigation.qaRenameId = session.id;
          this.qaNavigation.qaRenameTitle = session.title;
        },
        onRenameTitle: (title: string) => this.qaNavigation.qaRenameTitle = title,
        onCommitRename: () => this.qaNavigation.commitQaRename(),
        onCancelRename: () => this.qaNavigation.qaRenameId = '',
        onDelete: (session: RagSessionSummary) => this.confirmQaDelete(session),
        onRetry: () => this.qaNavigation.loadQaNavigation() })
    } else if (this.statsOpen) {
      StatsNavigation({ monthsOnly: false, onTaxonomy: () => this.openTaxonomy(), statsMonths: this.statsMonths, statsMonth: this.statsMonth,
        statsMonthsLoading: this.statsMonthsLoading, statsMonthsError: this.statsMonthsError,
        onMonth: (month: string) => {
          this.statsMonth = month; this.statsMonthRevision++; this.closeNavigation();
        }, onRetry: () => this.statsRefreshRevision++ })
    } else this.navigation()
  }

  @Builder
  private compactNavigationHeader() {
    Column({ space: 1 }) {
      Row({ space: 10 }) {
        Image(WORKSPACE_TABS[this.selectedTab()].activeIcon).width(20).height(20).objectFit(ImageFit.Contain)
        Text(this.notesOpen ? '随记' : this.favoritesOpen ? '收藏中心' : this.qaOpen ? '知识问答' :
          this.statsOpen ? '学习统计' : '学习日志')
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
      Text(this.notesOpen ? '按年份和标签筛选' : this.favoritesOpen ? '按分组和日志月份筛选' :
        this.qaOpen ? '历史会话' : this.statsOpen ? '切换月份与管理分类' : '按月份和日期浏览')
        .fontSize(11).fontColor($r('app.color.muted')).maxLines(1).margin({ left: 30 })
    }.width('100%').height(64).padding({ left: 18, right: 12 }).alignItems(HorizontalAlign.Start)
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
  }

  @Builder
  private exportMenuItem(label: string, scope: string) {
    Button({ type: ButtonType.Normal, stateEffect: false }) {
      Text(label).fontSize(13).fontColor($r('app.color.body'))
        .width('100%').textAlign(TextAlign.Start)
    }
    .width('100%').height(42).padding({ left: 12, right: 12 }).borderRadius(6)
    .attributeModifier(new InteractiveSurface(Color.Transparent, this.hoveredExport === scope))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredExport = hover ? scope : ''))
    .enabled(!this.exportBusy && (scope === 'all' || this.selectedDate.length > 0))
    .id(`log_export_${scope}`)
    .onClick(() => this.exportLogs(scope))
  }

  @Builder
  private exportActions() {
    Column() {
      this.exportMenuItem('当前日块', 'day')
      this.exportMenuItem('当前源文件', 'file')
      this.exportMenuItem('全部日志', 'all')
    }.width('100%').padding(4)
  }

  @Builder
  private editorActions() {
    Row({ space: this.headerWidth < 440 ? 4 : 8 }) {
      if (this.editorActionsInHeader()) {
        ToolbarAction({ label: '内部链接', icon: $r('app.media.link_2'), iconSize: 15,
          showLabel: true, available: this.editorReady && !this.linkOpening,
          onAction: () => this.openLink() })
        ToolbarAction({ label: '插入图片', icon: $r('app.media.upload'), iconSize: 15,
          showLabel: true, busy: this.imageBusy, available: !!this.day && this.editorReady,
          onAction: () => this.insertImages() })
        ToolbarAction({ label: '放弃修改', icon: $r('app.media.eye'), iconSize: 15,
          showLabel: true, available: this.editorReady && this.dirty,
          onAction: () => this.discardDraft() })
        ToolbarAction({ label: '查找替换', icon: $r('app.media.search'), iconSize: 15,
          showLabel: true, available: this.editorReady,
          onAction: () => this.editor.command('find') })
      }
      LogDisplayModeControl({ sourceMode: this.sourceMode, splitMode: this.splitMode,
        expanded: this.expandedModeSelector(), showLabels: this.showToolbarLabels('mode'),
        onMode: (mode: string) => this.switchMode(mode === 'source', mode === 'split') })
      Column() {
        ToolbarAction({ label: '刷新', icon: $r('app.media.refresh_cw'), iconSize: 15,
          showLabel: this.showToolbarLabels('refresh'),
          available: !this.saving && !this.deleting && !this.imageBusy,
          onAction: () => this.refreshLog() })
      }.width(this.desktopActionSlotWidth('refresh', '刷新')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('refresh', '刷新') - 1) })
        .opacity(this.desktopActionSlotPresence('refresh', '刷新'))
        .hitTestBehavior(this.documentActionsInHeader('refresh') ? HitTestMode.Default : HitTestMode.None)
        .accessibilityLevel(this.documentActionsInHeader('refresh') ? 'auto' : 'no-hide-descendants')
      Column() {
        ToolbarAction({ label: '导出', icon: $r('app.media.download'), iconSize: 15,
          showLabel: this.showToolbarLabels('export'), available: !this.exportBusy,
          onAction: () => this.exportMenuOpen = !this.exportMenuOpen })
          .bindPopup(this.exportMenuOpen, { builder: this.exportActions(), placement: Placement.BottomRight,
            popupColor: $r('app.color.canvas'), enableArrow: false, autoCancel: true,
            targetSpace: 4, width: 160, radius: 12, backgroundBlurStyle: BlurStyle.NONE,
            shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
            onStateChange: (event) => { this.exportMenuOpen = event.isVisible; this.hoveredExport = ''; } })
      }.width(this.desktopActionSlotWidth('export', '导出')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('export', '导出') - 1) })
        .opacity(this.desktopActionSlotPresence('export', '导出'))
        .hitTestBehavior(this.documentActionsInHeader('export') ? HitTestMode.Default : HitTestMode.None)
        .accessibilityLevel(this.documentActionsInHeader('export') ? 'auto' : 'no-hide-descendants')
      Column() {
        ToolbarAction({ label: '备份', icon: $r('app.media.database_backup'), iconSize: 15,
          showLabel: this.showToolbarLabels('backup'),
          available: !!this.day && !this.saving && !this.deleting,
          onAction: () => this.backupOpen = true })
      }.width(this.desktopActionSlotWidth('backup', '备份')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('backup', '备份') - 1) })
        .opacity(this.desktopActionSlotPresence('backup', '备份'))
        .hitTestBehavior(this.documentActionsInHeader('backup') ? HitTestMode.Default : HitTestMode.None)
        .accessibilityLevel(this.documentActionsInHeader('backup') ? 'auto' : 'no-hide-descendants')
      Column() {
        ToolbarAction({ label: '删除', icon: $r('app.media.trash_2'), iconSize: 15,
          showLabel: this.showToolbarLabels('delete'), danger: true, busy: this.deleting,
          available: !!this.day?.exists && !this.saving,
          onAction: () => this.confirmDelete() })
      }.width(this.desktopActionSlotWidth('delete', '删除')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('delete', '删除') - 1) })
        .opacity(this.desktopActionSlotPresence('delete', '删除'))
        .hitTestBehavior(this.documentActionsInHeader('delete') ? HitTestMode.Default : HitTestMode.None)
        .accessibilityLevel(this.documentActionsInHeader('delete') ? 'auto' : 'no-hide-descendants')
      ToolbarAction({ label: this.saving ? '保存中' : '保存', reservedLabel: '保存中',
        icon: $r('app.media.save'), iconSize: 15,
        showLabel: this.showToolbarLabels('save'), primary: true, busy: this.saving,
        available: this.editorReady && this.dirty, onAction: () => this.save() })
      ToolbarAction({ label: '更多日志操作', icon: $r('app.media.more_horizontal'),
        showLabel: false, active: this.moreOpen, onAction: () => this.moreOpen = !this.moreOpen })
        .id('log_more_actions')
        .bindPopup(this.moreOpen, { builder: this.moreActions(), placement: Placement.BottomRight,
          enableArrow: false, popupColor: $r('app.color.canvas'), autoCancel: true,
          targetSpace: 4, width: 220, radius: 12, backgroundBlurStyle: BlurStyle.NONE,
          shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
          onStateChange: (event) => {
            this.moreOpen = event.isVisible;
            if (!event.isVisible) this.handleActionsDisappear();
          } })
    }
  }

  @Builder
  private readingModeEntryButton() {
    ToolbarAction({ label: '进入阅读模式', showLabel: false,
      icon: $r('app.media.maximize_2'), iconSize: 17,
      onAction: () => this.setLogsReadingMode(true) }).id('log_reading_enter')
  }

  @Builder
  private heading() {
    if (this.isWide()) {
      Stack({ alignContent: Alignment.Top }) {
        Column() {
          DesktopLogHeader({ fileName: this.day?.fileName || '', selectedDate: this.selectedDate,
            workspaceBreakpoint: this.workspaceBreakpoint,
            toolbarWidth: this.headerWidth, dateWidth: this.headerDateWidth,
            previousButton: (): void => this.desktopAdjacentButton('上一篇', 1),
            nextButton: (): void => this.desktopAdjacentButton('下一篇', -1),
            actions: (): void => this.editorActions(),
            onWidth: (width: number) => this.updateToolbarWidth(width),
            onDateWidth: (width: number) => {
              if (width !== this.headerDateWidth) {
                this.headerDateWidth = Math.max(120, width);
                this.updateToolbarWidth(this.headerWidth);
              }
            } })
        }.width('100%').height(64)
          .opacity(Math.max(0, 1 - 2 * this.readingProgress))
          .visibility(this.readingProgress < 1 ? Visibility.Visible : Visibility.Hidden)
          .zIndex(this.logsReadingMode ? 0 : 1)
          .hitTestBehavior(this.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
          .accessibilityLevel(this.logsReadingMode ? 'no-hide-descendants' : 'auto')
        Column() {
          ReadingLogHeader({ selectedDate: this.selectedDate, workspaceBreakpoint: this.workspaceBreakpoint,
            hasOutline: this.outlineHeadings().length > 0,
            previousButton: (): void => this.desktopAdjacentButton('上一篇', 1),
            nextButton: (): void => this.desktopAdjacentButton('下一篇', -1),
            onOutline: () => this.readingOutlineOpen = true,
            onExit: () => this.setLogsReadingMode(false) })
        }.width('100%').height(64)
          .opacity(Math.max(0, 2 * this.readingProgress - 1))
          .visibility(this.readingProgress > 0 ? Visibility.Visible : Visibility.Hidden)
          .zIndex(this.logsReadingMode ? 1 : 0)
          .hitTestBehavior(this.logsReadingMode ? HitTestMode.Default : HitTestMode.None)
          .accessibilityLevel(this.logsReadingMode ? 'auto' : 'no-hide-descendants')
      }.width('100%').height(64).clip(true).id('log_reader_header')
    } else {
      CompactLogHeader({ selectedDate: this.selectedDate, workspaceBreakpoint: this.workspaceBreakpoint,
        sourceMode: this.sourceMode, saving: this.saving, dirty: this.editorReady && this.dirty,
        moreOpen: $moreOpen, moreActionsPanel: (): void => this.compactMoreActionsPanel(),
        onActionsDisappear: () => this.handleActionsDisappear(),
        onMode: (mode: string) => this.switchMode(mode === 'source'),
        onSave: () => this.save() })
    }
  }

  @Builder
  private desktopOutline() {
    Column({ space: 10 }) {
      Text('目录').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
        .width('100%').padding({ left: 8 })
      List({ space: 2 }) {
        ForEach(this.outlineHeadings(), (heading: LogOutlineHeading, index: number) => {
          ListItem() {
            Row({ space: 2 }) {
            Button({ type: ButtonType.Normal, stateEffect: false }) {
              Text(heading.text).width('100%').maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Start)
                .fontSize(12).fontWeight(this.activeOutlineIndex === index ? FontWeight.Medium : FontWeight.Regular)
                .fontColor(this.activeOutlineIndex === index ? $r('app.color.ink') : $r('app.color.muted'))
            }.layoutWeight(1).constraintSize({ minHeight: 30 })
              .padding({ left: 8, right: 4, top: 4, bottom: 4 })
              .onClick(() => {
                this.activeOutlineIndex = index;
                this.targetHeading = heading.text;
                this.targetHeadingIndex = index;
                this.targetRevision++;
                if (this.readingOutlineOpen) this.readingOutlineOpen = false;
              })
              .backgroundColor(Color.Transparent).borderRadius(6)
            if (heading.level === 3) {
              Button({ type: ButtonType.Normal }) {
                if (this.outlineFavorite(heading)) {
                  SymbolGlyph($r('sys.symbol.star_fill')).fontSize(14).fontColor([$r('app.color.ink')])
                } else {
                  SymbolGlyph($r('sys.symbol.star')).fontSize(14).fontColor([$r('app.color.muted_soft')])
                }
              }.width(28).height(28).padding(0).backgroundColor(Color.Transparent).borderRadius(6)
                .enabled(!this.favoriteBusy)
                .accessibilityText(this.outlineFavorite(heading) ? '取消收藏' : '收藏小节')
                .onClick(() => this.toggleOutlineFavorite(heading))
                .bindPopup(this.favoriteFeedbackVisible(heading), {
                  builder: () => { this.favoriteFeedbackPopup(heading) },
                  placement: Placement.Left, popupColor: $r('app.color.canvas'),
                  enableArrow: false, autoCancel: true, targetSpace: 8,
                  width: 236, radius: 10, backgroundBlurStyle: BlurStyle.NONE,
                  shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
                  onStateChange: (event) => {
                    if (!event.isVisible && this.favoriteFeedbackVisible(heading)) this.closeFavoriteFeedback();
                  }
                })
            }
            }.width('100%').padding({ right: 3 })
              .backgroundColor(this.activeOutlineIndex === index ? $r('app.color.surface_soft') : Color.Transparent)
              .border({ width: { left: this.activeOutlineIndex === index ? 2 : 0 },
                color: $r('app.color.primary') }).borderRadius(6)
          }
        }, (heading: LogOutlineHeading) => heading.id)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.width(this.readingOutlineOpen ? 320 : 224).height('100%')
      .padding({ left: 8, right: 8, top: 28, bottom: 18 })
      .border({ width: { left: this.readingOutlineOpen ? 0 : 1 }, color: $r('app.color.hairline_soft') })
  }

  private async importAiMaterial(): Promise<void> {
    if (this.ai.importing || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const instance = activeInstance.revision;
    const current = (): boolean => lifecycle === this.lifecycle && instance === activeInstance.revision;
    this.ai.importing = true;
    try {
      const materials = await new LogAiMaterialImport(
        this.getUIContext().getHostContext() as common.UIAbilityContext).pickAndExtract(current);
      if (!materials || !current()) return;
      if (materials.text) this.ai.material = `${this.ai.material}\n\n${materials.text}`.trim();
      this.ai.message = materials.warnings.join('\n');
    } catch (error) {
      if (current()) this.ai.message = error instanceof Error ? error.message : '材料导入失败';
    } finally { if (lifecycle === this.lifecycle) this.ai.importing = false; }
  }

  private async highlightAiDraft(): Promise<void> {
    if (!this.day || this.ai.busy) return;
    try {
      const date = this.day.date;
      let body = this.draftText;
      if (this.editorReady) {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== date || this.day?.date !== date) return;
        body = snapshot.text;
      } else if (this.sourceMode || this.splitMode) {
        this.ai.message = '编辑器尚未就绪，请稍后重试';
        return;
      }
      this.draftText = body;
      this.dirty = body !== this.savedText;
      this.reportDraft();
      await this.ai.highlight(date, body);
    } catch (error) { this.ai.message = error instanceof Error ? error.message : '编辑器尚未就绪'; }
  }

  @Builder
  private compactOutlinePanel() {
    Column() {
      Row({ space: 10 }) {
        SymbolGlyph($r('sys.symbol.list_bullet')).fontSize(20)
          .fontColor([$r('app.color.primary_active')])
        Column({ space: 1 }) {
          Text('日志大纲').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
          Text(`${this.selectedDate} · ${this.outlineHeadings().length} 个标题`)
            .fontSize(11).fontColor($r('app.color.muted'))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(17).fontColor([$r('app.color.body')])
        }.width(40).height(40).padding(0)
          .backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') })
          .borderRadius(8).clip(true)
          .onClick(() => this.closeOutline())
          .accessibilityText('关闭大纲').bindTips('关闭大纲', WORKSPACE_TIPS)
      }.width('100%').height(64).padding({ left: 18, right: 12 })
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
      List({ space: 8 }) {
        ForEach(this.outlineHeadings(), (heading: LogOutlineHeading, index: number) => {
          ListItem() {
            Row() {
              Button({ type: ButtonType.Normal }) {
                Text(heading.text)
                  .fontSize(heading.level <= 2 ? 15 : (heading.level === 3 ? 14 : 13))
                  .fontWeight(heading.level <= 2 ? FontWeight.Medium : FontWeight.Regular)
                  .fontColor(this.activeOutlineIndex === index ? $r('app.color.ink') :
                    (heading.level <= 3 ? $r('app.color.body') : $r('app.color.muted')))
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%').textAlign(TextAlign.Start)
              }.layoutWeight(1).constraintSize({ minHeight: 44 })
                .padding({ left: 10 + Math.max(0, heading.level - 2) * 12, right: 4, top: 7, bottom: 7 })
                .backgroundColor(Color.Transparent).borderRadius(8)
                .onClick(() => {
                  this.closeOutline();
                  this.activeOutlineIndex = index;
                  this.targetHeading = heading.text;
                  this.targetHeadingIndex = index;
                  this.targetRevision++;
                  if (this.sourceMode || this.splitMode) this.switchMode(false);
                })
              if (heading.level === 3) {
                Button({ type: ButtonType.Normal }) {
                  if (this.outlineFavorite(heading)) {
                    SymbolGlyph($r('sys.symbol.star_fill')).fontSize(15).fontColor([$r('app.color.ink')])
                  } else {
                    SymbolGlyph($r('sys.symbol.star')).fontSize(15).fontColor([$r('app.color.muted_soft')])
                  }
                }.width(32).height(32).padding(0)
                  .backgroundColor(Color.Transparent).borderRadius(6)
                  .enabled(!this.favoriteBusy).monopolizeEvents(true)
                  .accessibilityText(this.outlineFavorite(heading) ? '取消收藏' : '收藏小节')
                  .onClick(() => this.toggleOutlineFavorite(heading))
                  .bindPopup(this.favoriteFeedbackVisible(heading), {
                    builder: () => { this.favoriteFeedbackPopup(heading) },
                    placement: Placement.Left, popupColor: $r('app.color.canvas'),
                    enableArrow: false, autoCancel: true, targetSpace: 8,
                    width: 236, radius: 10, backgroundBlurStyle: BlurStyle.NONE,
                    shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
                    onStateChange: (event) => {
                      if (!event.isVisible && this.favoriteFeedbackVisible(heading)) this.closeFavoriteFeedback();
                    }
                  })
              }
            }.width('100%').constraintSize({ minHeight: 44 }).padding({ right: 4 })
              .backgroundColor(this.activeOutlineIndex === index ? $r('app.color.primary_tint') :
                $r('app.color.surface_card'))
              .border({ width: 1, color: this.activeOutlineIndex === index ?
                $r('app.color.primary') : $r('app.color.hairline') })
              .borderRadius(8).clip(true)
          }
        }, (heading: LogOutlineHeading) => heading.id)
      }.width('100%').layoutWeight(1)
        .padding({ left: 14, right: 14, top: 14, bottom: 28 })
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    }.width(this.isWide() ? 320 : '82%').height('100%')
      .backgroundColor($r('app.color.surface_soft'))
      .border({ width: { left: 1 }, color: $r('app.color.hairline') })
      .shadow({ radius: 18, color: $r('app.color.popover_shadow'), offsetX: -4 })
      .translate({ x: this.outlineOffset })
  }

  private async prepareEditorForAi(date: string, lifecycle: number): Promise<boolean> {
    if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
    if (lifecycle !== this.lifecycle || this.day?.date !== date) return false;
    for (let attempt = 0; attempt < 50 && this.editor.loadedDocumentKey !== date; attempt += 1) {
      if (lifecycle !== this.lifecycle || this.day?.date !== date) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (!this.editorReady || this.editor.loadedDocumentKey !== date) {
      throw new Error('编辑器尚未就绪，请稍后重试');
    }
    return true;
  }

  private async applyAiOutput(): Promise<void> {
    if (!this.day || !this.ai.output.trim() || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const date = this.day.date;
    const revision = this.ai.requestRevision;
    const output = this.ai.output;
    const current = (): boolean => lifecycle === this.lifecycle && this.day?.date === date &&
      revision === this.ai.requestRevision && this.ai.outputDate === date && this.ai.output === output && !this.ai.busy;
    if (this.ai.outputDate !== date) { this.ai.message = '请切回生成草稿时的日块'; return; }
    try {
      if (!await this.prepareEditorForAi(date, lifecycle)) return;
      if (!current()) return;
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || !current()) return;
      const body = snapshot.text.trimEnd();
      await this.editor.replace(`${body}${body ? '\n\n' : ''}${output.trim()}\n`);
      if (!current()) return;
      this.sourceMode = true; this.splitMode = false;
      appFeedback.show('AI 草稿已写入当前编辑草稿，尚未保存');
    } catch (error) {
      if (current()) this.ai.message = error instanceof Error ? error.message : '写入编辑草稿失败';
    }
  }

  private async applyAiHighlight(): Promise<void> {
    if (!this.day || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const date = this.day.date;
    const revision = this.ai.requestRevision;
    const highlighted = this.ai.highlighted;
    const originalDraft = this.ai.originalDraft;
    const current = (): boolean => lifecycle === this.lifecycle && this.day?.date === date &&
      revision === this.ai.requestRevision && this.ai.highlightDate === date &&
      this.ai.highlighted === highlighted && this.ai.originalDraft === originalDraft && !this.ai.busy;
    try {
      if (!await this.prepareEditorForAi(date, lifecycle)) return;
      if (!current()) return;
      const snapshot = await this.editor.command('snapshot');
      if (!current()) return;
      if (snapshot.documentKey !== date || snapshot.text !== originalDraft) {
        this.ai.message = '当前日块或编辑草稿已变化，请重新标注重点'; return;
      }
      await this.editor.replace(highlighted);
      if (!current()) return;
      this.ai.reviewOpen = false;
      this.sourceMode = true; this.splitMode = false;
      appFeedback.show('已应用重点标注，尚未保存');
    } catch (error) {
      if (current()) this.ai.message = error instanceof Error ? error.message : '应用重点标注失败';
    }
  }

  private openAiTools(mode: string = 'generate'): void {
    if (this.sidebarAnimating) return;
    this.aiMode = mode;
    if (this.aiOpen && !this.aiClosing) return;
    this.aiClosing = false;
    this.aiOpen = true;
    this.moveAiTools(0);
  }

  private closeAiTools(): void {
    if (this.sidebarAnimating) return;
    if (!this.aiOpen || this.aiClosing) return;
    this.aiClosing = true;
    this.moveAiTools(420);
  }

  private beginToolbarMotion(width: number): number[][] {
    const actions = ['refresh', 'export', 'backup', 'delete'];
    const labels = ['刷新', '导出', '备份', '删除'];
    const originalWidths = actions.map((action: string, index: number) =>
      this.desktopActionSlotWidth(action, labels[index]));
    this.toolbarActionWidths = originalWidths;
    this.toolbarMotionWidth = Math.max(0, width);
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut }, () => {
      this.updateToolbarWidth(this.toolbarMotionWidth);
    });
    const targetWidths = actions.map((action: string, index: number) =>
      !this.documentActionsInHeader(action) ? 0 :
        (this.showToolbarLabels(action) ? toolbarActionWidth(labels[index]) : 40));
    return [originalWidths, targetWidths];
  }

  private advanceToolbarMotion(widths: number[][], progress: number): void {
    this.toolbarActionWidths = widths[0].map((width: number, index: number) =>
      width + (widths[1][index] - width) * progress);
  }

  private finishToolbarMotion(): void {
    this.toolbarMotionWidth = -1;
    this.toolbarActionWidths = [];
  }

  private moveAiTools(target: number): void {
    const revision = ++this.aiMotionRevision;
    this.aiAnimating = true;
    const origin = this.aiOffset;
    const toolbarWidths = this.isWide() ? this.beginToolbarMotion(this.aiAvailableWidth -
      this.desktopNavigationWidth() - (target === 0 ? this.aiPanelWidth : 52)) : [];
    const started = Date.now();
    const step = (): void => {
      if (revision !== this.aiMotionRevision) return;
      const progress = Math.min(1, Math.max(0, (Date.now() - started) / 240));
      const eased = progress * progress * (3 - 2 * progress);
      this.aiOffset = origin + (target - origin) * eased;
      if (this.isWide()) this.advanceToolbarMotion(toolbarWidths, eased);
      if (progress < 1) this.getUIContext().postFrameCallback(new FrameAction(step));
      else {
        this.aiAnimating = false;
        if (target === 420) {
          this.aiOpen = false;
          this.aiClosing = false;
        }
        if (this.isWide()) {
          this.getUIContext().postFrameCallback(new FrameAction(() => {
            if (revision !== this.aiMotionRevision || this.sidebarAnimating) return;
            this.finishToolbarMotion();
          }));
        }
      }
    };
    this.getUIContext().postFrameCallback(new FrameAction(step));
  }

  private resizeAiPanel(width: number): void {
    this.aiPanelWidth = Math.max(220, Math.min(width, 720, Math.max(220, this.aiAvailableWidth - 400)));
  }

  private finishAiResize(): void {
    this.aiResizing = false;
    if (!this.aiResizeHovered) this.getUIContext().getCursorController().restoreDefault();
  }

  @Builder
  private aiResizer() {
    Stack({ alignContent: Alignment.Start }) {
      Row().width(2).height('100%')
        .backgroundColor(this.aiResizeHovered || this.aiResizing ? $r('app.color.primary') : Color.Transparent)
        .hitTestBehavior(HitTestMode.None)
    }.width(8).height('100%').backgroundColor(Color.Transparent)
      .position({ x: 0, y: 0 }).zIndex(15).focusable(true)
      .accessibilityText('调整右侧栏宽度').bindTips('拖拽调整右侧栏宽度', WORKSPACE_TIPS)
      .id('log_ai_resizer')
      .onHover((hovered: boolean) => {
        this.aiResizeHovered = hovered;
        if (hovered || this.aiResizing) this.getUIContext().getCursorController().setCursor(pointer.PointerStyle.WEST_EAST);
        else this.getUIContext().getCursorController().restoreDefault();
      })
      .onDisAppear(() => {
        this.aiResizeHovered = false;
        this.aiResizing = false;
        this.getUIContext().getCursorController().restoreDefault();
      })
      .gesture(PanGesture({ direction: PanDirection.Horizontal, distance: 1 })
        .onActionStart(() => {
          this.aiWidthAdjusted = true;
          this.aiResizeStart = this.aiPanelWidth;
          this.aiResizing = true;
          this.getUIContext().getCursorController().setCursor(pointer.PointerStyle.WEST_EAST);
        })
        .onActionUpdate((event: GestureEvent) => this.resizeAiPanel(this.aiResizeStart - event.offsetX))
        .onActionEnd(() => this.finishAiResize())
        .onActionCancel(() => this.finishAiResize()))
      .onKeyEvent((event: KeyEvent) => {
        if (event.type !== KeyType.Down) return;
        if (event.keyCode === KeyCode.KEYCODE_DPAD_LEFT || event.keyCode === KeyCode.KEYCODE_DPAD_RIGHT) {
          event.stopPropagation();
          this.aiWidthAdjusted = true;
          this.resizeAiPanel(this.aiPanelWidth + (event.keyCode === KeyCode.KEYCODE_DPAD_LEFT ? 16 : -16));
        }
      })
  }

  @Builder
  private aiToolsPanel() {
    LogAiPanel({ mode: $aiMode, instruction: this.ai.instruction,
      material: this.ai.material, output: this.ai.output,
      onInstruction: (value: string) => this.ai.instruction = value,
      onMaterial: (value: string) => this.ai.material = value,
      onOutput: (value: string) => this.ai.output = value,
      busy: this.ai.busy, importing: this.ai.importing, ready: !!this.day,
      generateConfigured: !!activeInstance.capabilities?.features.aiWriting.configured,
      highlightConfigured: !!activeInstance.capabilities?.features.aiHighlighting.configured,
      canHighlight: !!this.draftText.trim(),
      canApply: !!this.ai.output.trim() && this.ai.outputDate === this.selectedDate,
      message: this.ai.message || (this.aiMode === 'generate' &&
        !activeInstance.capabilities?.features.aiWriting.configured || this.aiMode === 'highlight' &&
        !activeInstance.capabilities?.features.aiHighlighting.configured ?
        '当前实例尚未配置对应模型能力' : ''),
      desktop: this.isWide(), onClose: () => this.closeAiTools(),
      onImport: () => this.importAiMaterial(),
      onGenerate: () => this.ai.generate(this.selectedDate),
      onHighlight: () => this.highlightAiDraft(), onApply: () => this.applyAiOutput() })
    .width(this.isWide() ? this.aiPanelWidth : '100%').height('100%')
    .translate({ x: (this.isWide() ? this.aiPanelWidth : this.aiAvailableWidth) * this.aiOffset / 420 })
    .flexShrink(0).id('log_ai_panel')
  }

  @Builder
  private aiToolsRail() {
    Column({ space: 8 }) {
      Button({ type: ButtonType.Normal }) {
        SymbolGlyph($r('sys.symbol.chevron_backward')).fontSize(17).fontColor([$r('app.color.muted')])
      }.width(38).height(38).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
        .id('log_ai_expand_button').accessibilityText('展开右侧栏')
        .bindTips('展开右侧栏', WORKSPACE_TIPS).onClick(() => this.openAiTools(this.aiMode))
      Button({ type: ButtonType.Normal }) {
        Image($r('app.media.wand_sparkles')).width(17).height(17).objectFit(ImageFit.Contain)
      }.width(38).height(38).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
        .id('log_ai_generate_button').accessibilityText('AI生成')
        .bindTips('AI生成', WORKSPACE_TIPS).onClick(() => this.openAiTools('generate'))
      Button({ type: ButtonType.Normal }) {
        Image($r('app.media.edit_3')).width(17).height(17).objectFit(ImageFit.Contain)
      }.width(38).height(38).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
        .id('log_ai_highlight_button').accessibilityText('重点标注')
        .bindTips('重点标注', WORKSPACE_TIPS).onClick(() => this.openAiTools('highlight'))
    }.width(52).height('100%').padding({ top: 14 }).alignItems(HorizontalAlign.Center)
      .opacity(this.aiOffset / 420)
      .hitTestBehavior(this.aiOpen && !this.aiClosing ? HitTestMode.None : HitTestMode.Default)
      .id('log_ai_rail')
      .backgroundColor($r('app.color.surface_soft'))
  }

  @Builder
  private reader() {
    Column() {
      if (this.errorMessage && this.day && !this.dayLoading && !this.daysLoading) {
        InlineStatus({ text: this.errorMessage, error: true, retry: this.readFailed,
          onRetry: () => this.retryRead() })
      }
      this.heading()
      if (this.monthsLoading || !this.day && (this.daysLoading || this.dayLoading)) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在加载日志').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.errorMessage && !this.day) {
        LoadFailure({ message: this.errorMessage,
          onRetry: () => this.retryRead() })
      } else if (this.day) {
        Stack({ alignContent: Alignment.TopEnd }) {
          Row() {
            SourceEditor({ session: this.editor, documentKey: this.day.date,
              initialText: this.editorInitialText })
              .width(this.isWide() && this.splitMode ? '50%' : (this.sourceMode || this.splitMode ? '100%' : 0))
              .height('100%')
              .visibility(this.sourceMode || this.splitMode ? Visibility.Visible : Visibility.None)
              .border({ width: { right: this.isWide() && this.splitMode ? 1 : 0 },
                color: $r('app.color.hairline') })
            Row() {
              Stack({ alignContent: Alignment.TopEnd }) {
              MarkdownReader({ content: this.previewText, contentMode: 'log', documentKey: this.day.date,
                themePreference: this.themePreference,
                stableViewport: this.isWide(), fillAvailableWidth: this.splitMode,
                viewportRequestRevision: this.modeLayoutRevision + this.workspaceLayoutRevision,
                restoreScrollOffset: this.previewRestoreOffset,
                showBackToTop: !this.isWide(), trackScrollProgress: true,
                scrollToTopRequestRevision: this.previewTopRequest,
                onScrollProgress: (progress: number) => this.previewProgress = progress,
                onScrollPosition: (offset: number) => {
                  this.previewOffset = offset;
                  if (this.renderedPreviewDate) this.previewScrollOffsets[this.renderedPreviewDate] = Math.max(0, offset);
                },
                onViewportReady: () => {
                  this.workspaceTransition.finish('mode');
                  if (this.readingTransition.animating) {
                    this.readingTransition.viewportReady = true;
                    this.readingTransition.finish();
                  }
                },
                onContentRendered: (_content: string, date: string) => {
                  if (date === this.selectedDate && !this.dayLoading && !this.daysLoading) {
                    this.readerReady = true;
                    this.renderedPreviewDate = date;
                    this.workspaceTransition.finish('document');
                  }
                },
                onRenderFailed: (date: string) => {
                  if (date !== this.selectedDate) return;
                  this.errorMessage = '日志正文渲染失败，请刷新重试';
                  this.workspaceTransition.finish('document');
                },
                targetHeading: this.targetHeading, targetHeadingIndex: this.targetHeadingIndex,
                targetKind: this.targetKind, targetQuery: this.targetQuery, targetRevision: this.targetRevision,
                trackActiveHeading: true,
                onActiveHeading: (headingId: string) => this.updateActiveOutline(headingId),
                onInternalLink: (date: string, heading: string) => {
                  const targetDate = date || this.selectedDate;
                  if (!targetDate) return;
                  if (targetDate === this.selectedDate) this.openInternalLink(targetDate, heading);
                  else this.confirmDiscard(() => this.openInternalLink(targetDate, heading));
                } })
                .width('100%').height('100%').id('log_reading_surface')
                .onAreaChange((_oldArea: Area, area: Area) => this.readingViewportChanged(area))
              if (!this.readerReady && !this.renderedPreviewDate && !this.sourceMode) {
                Column() {
                  LoadingProgress().width(26).height(26).color($r('app.color.primary'))
                }.width('100%').height('100%').justifyContent(FlexAlign.Center)
                  .backgroundColor($r('app.color.canvas')).zIndex(2)
                  .hitTestBehavior(HitTestMode.None)
              }
              if (this.isWide() && !this.logsReadingMode && !this.sourceMode && !this.splitMode &&
                this.readerReady && this.renderedPreviewDate === this.selectedDate) {
                Column() { this.readingModeEntryButton() }
                  .width(36).height(36).margin({ top: 16, right: 16 }).zIndex(3)
              }
              }.layoutWeight(1).height('100%')
              if (this.showDesktopOutline()) this.desktopOutline()
            }.width(this.isWide() && this.splitMode ? '50%' :
              (this.sourceMode || this.splitMode && !this.isWide() ? 0 : '100%'))
              .height('100%').visibility(this.sourceMode || this.splitMode && !this.isWide() ?
                Visibility.None : Visibility.Visible)
          }.width('100%').height('100%')
          LoadingHintAnchor({ loading: this.dayLoading || this.daysLoading ||
            !this.sourceMode && this.renderedPreviewDate.length > 0 && !this.readerReady,
            onChange: (placement: LoadingHintPlacement) => this.logLoadingHint = placement })
            .hitTestBehavior(HitTestMode.None)
          if (this.saveError) {
            Text(this.saveError).fontSize(13).fontColor($r('app.color.error'))
              .width('100%').padding(12).backgroundColor($r('app.color.surface_soft'))
              .align(Alignment.Bottom)
          }
        }.layoutWeight(1).width('100%')
      } else {
        EmptyState({ title: '暂无学习日志', description: '当前实例还没有可阅读的日志。' })
      }
    }.layoutWeight(1).height('100%')
  }

  private desktopTopActionsWidth(labels: boolean): number {
    return labels ? toolbarActionsWidth(['随记', '收藏', '问答', '统计']) + 64 : 5 * 40 + 4 * 12;
  }

  private desktopTopSearchWidth(): number {
    return Math.max(260, Math.min(384, this.desktopTopBarWidth * 0.27,
      this.desktopTopBarWidth - 208 - this.desktopTopActionsWidth(this.desktopTopBarDensity === ToolbarDensity.FULL) - 48));
  }

  build() {
    Stack() {
      Column() {
        if (this.isWide()) {
        Stack({ alignContent: Alignment.Top }) {
        Row({ space: 12 }) {
          if (!this.isWide() && !this.statsOpen && !this.favoritesOpen && !this.notesOpen && !this.qaOpen) {
            Button({ type: ButtonType.Normal }) {
              SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(20).fontColor([$r('app.color.ink')])
            }.width(42).height(42).backgroundColor(Color.Transparent).accessibilityText('打开日期导航')
              .onClick(() => this.openNavigation())
          }
          Row({ space: 10 }) {
            AppLogo({ iconSize: 38, cornerRadius: 8 })
            Column({ space: 2 }) {
              Text('学习日志工作台').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
                .fontSize(15).fontWeight(FontWeight.Bold).fontColor($r('app.color.ink')).maxLines(1)
              Text(this.notesOpen ? '随记' : this.qaOpen ? '知识问答' : this.statsOpen ? '学习统计' : this.favoritesOpen ? '收藏中心' :
                (this.day?.headings[0] || this.selectedDate || '日志'))
                .fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(12)
                .fontColor($r('app.color.muted')).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          }.layoutWeight(1).constraintSize({ minWidth: 208 })
          if (this.desktopTopBarDensity !== ToolbarDensity.OVERFLOW) {
            Stack({ alignContent: Alignment.TopStart }) {
              SearchField({ value: this.searchQuery, focusKey: 'global_log_search',
                focusRevision: this.searchFocusRevision,
                placeholder: this.searchHeadingsOnly ? '搜索小节标题' : '搜索日志、术语、代码标识',
                loading: this.searchLoading, showHeadingToggle: true, headingOnly: this.searchHeadingsOnly,
                showCaseToggle: true, caseSensitive: !this.searchIgnoreCase,
                onChange: (query: string) => this.changeSearch(query),
                onSubmit: () => { this.searchOpen = true; this.searchLogs(); },
                onClear: () => this.changeSearch(''),
                onHeadingToggle: () => this.searchHeadingsOnly = !this.searchHeadingsOnly,
                onCaseToggle: () => this.searchIgnoreCase = !this.searchIgnoreCase,
                onFocusChange: (focused: boolean) => { if (focused) this.searchOpen = true; },
                onSearchKey: (event: KeyEvent) => {
                  if (!this.searchOpen || this.calendarOpen ||
                    !workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) return false;
                  this.closeSearch(); return true;
                } })
              this.desktopSearchResults()
            }.width(this.desktopTopSearchWidth()).height(42).zIndex(40)
          } else {
            ToolbarAction({ label: '搜索日志内容', icon: $r('app.media.search'),
              showLabel: false, onAction: () => {
                this.searchOpen = true;
                this.searchFocusRevision++;
              } })
          }
            ToolbarAction({ label: '随记', icon: $r('app.media.tab_lightbulb_active'),
              showLabel: this.desktopTopBarDensity === ToolbarDensity.FULL, active: this.notesOpen,
              onAction: () => this.selectTab(this.notesOpen ? 0 : 1) })
            ToolbarAction({ label: '收藏', icon: $r('app.media.tab_star_active'),
              showLabel: this.desktopTopBarDensity === ToolbarDensity.FULL, active: this.favoritesOpen,
              onAction: () => this.selectTab(this.favoritesOpen ? 0 : 2) })
            ToolbarAction({ label: '问答', icon: $r('app.media.tab_message_square_text_active'),
              showLabel: this.desktopTopBarDensity === ToolbarDensity.FULL, active: this.qaOpen,
              onAction: () => this.selectTab(this.qaOpen ? 0 : 3) })
            ToolbarAction({ label: '统计', icon: $r('app.media.tab_chart_column'),
              showLabel: this.desktopTopBarDensity === ToolbarDensity.FULL, active: this.statsOpen,
              onAction: () => this.selectTab(this.statsOpen ? 0 : 4) })
          ToolbarAction({ label: '更多设置', icon: $r('app.media.more_horizontal'), showLabel: false,
            active: this.topMoreOpen, onAction: () => this.topMoreOpen = !this.topMoreOpen })
            .bindPopup(this.topMoreOpen, { builder: this.topMoreActions(), placement: Placement.BottomRight,
              enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
              onStateChange: (event) => { if (!event.isVisible) this.topMoreOpen = false; } })
        }.width('100%').height(64).padding({ left: 12, right: 12 })
          .onAreaChange((_oldArea: Area, area: Area) => {
            this.desktopTopBarWidth = Number(area.width);
            this.desktopTopBarDensity = resolveToolbarDensity(this.desktopTopBarWidth,
              208 + 260 + this.desktopTopActionsWidth(false) + 48,
              208 + 260 + this.desktopTopActionsWidth(true) + 48,
              this.desktopTopBarDensity);
          })
          .backgroundColor($r('app.color.canvas'))
          .zIndex(30)
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
          .translate({ y: -64 * this.readingProgress })
        }.width('100%').height(64 * (1 - this.readingProgress))
          .clip(this.readingTransition.animating || this.logsReadingMode)
          .hitTestBehavior(this.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
        } else {
          AppTopBar({ title: this.notesOpen ? '随记' : this.favoritesOpen ? '收藏中心' :
            this.qaOpen ? '知识问答' : this.statsOpen ? '学习统计' : '学习日志',
            onOpenNavigation: () => this.openNavigation(),
            onOpenSearch: () => this.searchOpen = true,
            onOpenMore: () => this.compactSettingsOpen = true })
            .bindSheet($$this.compactSettingsOpen, this.compactAppSettingsPanel(), {
              preferType: SheetType.BOTTOM, height: SheetSize.FIT_CONTENT,
              dragBar: false, showClose: false, maskColor: $r('app.color.scrim'),
              radius: LengthMetrics.vp(12)
            })
        }
        Stack() {
          Row() {
              if (this.isWide()) { this.desktopNavigation() }
              QaPage({ workspaceActive: this.qaOpen, navigationSessionId: this.qaSessionId,
                themePreference: this.themePreference,
                navigationRequestRevision: this.qaRequestRevision, discardRevision: this.qaDiscardRevision,
                questionFocusRevision: this.qaQuestionFocusRevision, topRevision: this.topRequests[3],
                configured: !!activeInstance.capabilities?.features.rag.configured,
                onSessionsChange: (sessions: RagSessionSummary[]) => this.qaNavigation.acceptQaNavigation(sessions),
                onSessionsError: (message: string) => this.qaNavigation.qaNavigationError = message,
                onActiveSessionChange: (id: string) => this.qaSessionId = id,
                onBusyChange: (busy: boolean) => this.qaBusy = busy,
                onDraftChange: (dirty: boolean) => this.qaDirty = dirty,
                onPendingChange: (pending: boolean) => this.qaPending = pending,
                onLoadingHintChange: (placement: LoadingHintPlacement) => this.qaLoadingHint = placement,
                onOpenLog: () => this.selectTab(0),
                onCitation: (date: string, heading: string, headingIndex: number) =>
                  this.openQaCitation(date, heading, headingIndex) }).layoutWeight(1)
          }.width('100%').height('100%')
            .visibility(this.qaOpen || this.outgoingTab === 3 ? Visibility.Visible : Visibility.None)
            .opacity(this.qaOpen ? this.moduleReveal : 1)
            .hitTestBehavior(this.qaOpen ? HitTestMode.Default : HitTestMode.None)
            .zIndex(this.qaOpen ? 1 : 0)
          Row() {
              if (this.isWide()) { this.desktopNavigation() }
              NotesPage({ workspaceActive: this.notesOpen,
                navigationYear: this.noteYearFilter, navigationTag: this.noteTagFilter,
                navigationNewRevision: this.noteNewRevision, discardRevision: this.noteDiscardRevision,
                saveRevision: this.noteSaveRevision, topRevision: this.topRequests[1],
                onNavigationDataChange: (years: StudyNoteFacet[], tags: StudyNoteFacet[], total: number) => {
                  this.noteYears = years; this.noteTags = tags; this.noteCount = total;
                },
                onEditorBusyChange: (busy: boolean) => this.notesBusy = busy,
                onDirtyChange: (dirty: boolean) => this.notesDirty = dirty,
                onLoadingHintChange: (placement: LoadingHintPlacement) => this.notesLoadingHint = placement,
                onOpenLog: () => this.selectTab(0),
                onInternalLink: (date: string, heading: string) => this.openNoteLink(date, heading) }).layoutWeight(1)
          }.width('100%').height('100%')
            .visibility(this.notesOpen || this.outgoingTab === 1 ? Visibility.Visible : Visibility.None)
            .opacity(this.notesOpen ? this.moduleReveal : 1)
            .hitTestBehavior(this.notesOpen ? HitTestMode.Default : HitTestMode.None)
            .zIndex(this.notesOpen ? 1 : 0)
          Row() {
              if (this.isWide()) { this.desktopNavigation() }
              FavoritesPage({ data: this.favoritesData, viewMode: this.favoritesViewMode,
                topRevision: this.topRequests[2],
                onLoadingHintChange: (placement: LoadingHintPlacement) => this.favoritesLoadingHint = placement,
                onViewModeChange: (mode: string) => {
                  workspacePreferences.set('favoritesView', mode)
                    .catch(() => appFeedback.show('收藏显示方式保存失败', 'error'));
                },
                onOpenLog: () => this.selectTab(0),
                onOpenFavorite: (favorite: FavoriteHeading) => this.openFavorite(favorite) }).layoutWeight(1)
          }.width('100%').height('100%')
            .visibility(this.favoritesOpen || this.outgoingTab === 2 ? Visibility.Visible : Visibility.None)
            .opacity(this.favoritesOpen ? this.moduleReveal : 1)
            .hitTestBehavior(this.favoritesOpen ? HitTestMode.Default : HitTestMode.None)
            .zIndex(this.favoritesOpen ? 1 : 0)
          Row() {
              if (this.isWide()) { this.desktopNavigation() }
              Stack() {
                StatsPage({ showTaxonomyManager: true, onOpenTaxonomyManager: () => this.openTaxonomy(),
                  topRevision: this.topRequests[4],
                  requestedMonth: this.statsMonth, requestedMonthRevision: this.statsMonthRevision,
                  refreshRevision: this.statsRefreshRevision,
                  onLoadingHintChange: (placement: LoadingHintPlacement) => this.statsLoadingHint = placement,
                  onMonthsChange: (months: MonthSummary[]) => this.statsMonths = months,
                  onMonthsLoadingChange: (loading: boolean) => this.statsMonthsLoading = loading,
                  onMonthsErrorChange: (error: string) => this.statsMonthsError = error,
                  onSelectedMonthChange: (month: string) => this.statsMonth = month,
                  onOpenLog: () => this.selectTab(0),
                  onOpenEntry: (entry: StatsEntry) => this.openStatsEntry(entry) })
                  .width('100%').height('100%')
                if (this.isWide() && this.taxonomyOpen) {
                  TaxonomyManagerPage({
                    onBack: () => this.confirmTaxonomyLeave(() => {}),
                    onStateChange: (dirty: boolean, busy: boolean) => {
                      this.taxonomyDirty = dirty; this.taxonomyBusy = busy;
                    },
                    onSaved: () => this.statsRefreshRevision++
                  }).width('100%').height('100%').transition(secondaryPageTransition())
                }
              }.layoutWeight(1).height('100%')
          }.width('100%').height('100%')
            .visibility(this.statsOpen || this.outgoingTab === 4 ? Visibility.Visible : Visibility.None)
            .opacity(this.statsOpen ? this.moduleReveal : 1)
            .hitTestBehavior(this.statsOpen ? HitTestMode.Default : HitTestMode.None)
            .zIndex(this.statsOpen ? 1 : 0)
          Row() {
            if (this.isWide()) {
              Stack({ alignContent: Alignment.TopStart }) {
                Column() { this.desktopNavigation() }.width(this.desktopNavigationWidth()).height('100%')
                  .translate({ x: -this.desktopNavigationWidth() * this.readingProgress })
              }.width(this.desktopNavigationWidth() * (1 - this.readingProgress)).height('100%')
                .clip(this.readingTransition.animating || this.logsReadingMode)
                .hitTestBehavior(this.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
            }
            if (this.isWide()) {
              Stack({ alignContent: Alignment.BottomEnd }) {
                Column() { this.reader() }.width('100%').height('100%')
                BackToTopControl({ visible: !this.sourceMode && this.previewOffset > 8,
                  progress: this.previewProgress, scrollOffset: this.previewOffset,
                  onBackToTop: () => this.previewTopRequest++ })
                  .margin({ right: 14, bottom: 14 }).zIndex(3)
              }.layoutWeight(1).height('100%')
            } else {
              this.reader()
            }
            if (this.isWide()) {
              Stack({ alignContent: Alignment.TopEnd }) {
                this.aiToolsRail()
                if (this.aiOpen) this.aiToolsPanel()
                if (this.aiOpen && this.aiOffset === 0 && !this.logsReadingMode) this.aiResizer()
              }.width((52 + (this.aiPanelWidth - 52) * (1 - this.aiOffset / 420)) *
                  (1 - this.readingProgress))
                .height('100%')
                .backgroundColor(this.aiOpen ? $r('app.color.canvas') : $r('app.color.surface_soft'))
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                .border({ width: { left: 1 }, color: $r('app.color.hairline') })
                .hitTestBehavior(this.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
                .clip(true).id('log_ai_dock')
            }
          }.width('100%').height('100%')
            .visibility(this.selectedTab() === 0 || this.outgoingTab === 0 ? Visibility.Visible : Visibility.None)
            .opacity(this.selectedTab() === 0 ? this.moduleReveal : 1)
            .hitTestBehavior(this.selectedTab() === 0 ? HitTestMode.Default : HitTestMode.None)
            .zIndex(this.selectedTab() === 0 ? 1 : 0)
            .onAreaChange((_: Area, area: Area) => {
            this.aiAvailableWidth = Number(area.width);
            this.resizeAiPanel(this.aiWidthAdjusted ? this.aiPanelWidth : 340);
            if (this.isWide() && this.aiOpen && !this.aiClosing && !this.aiAnimating && this.aiOffset === 420) {
              this.moveAiTools(0);
            }
          })
          if (this.aiOpen && !this.isWide() && this.selectedTab() === 0) {
            Stack({ alignContent: Alignment.TopEnd }) { this.aiToolsPanel() }
              .width('100%').height('100%').zIndex(2)
          }
          if (this.outlineOpen && this.selectedTab() === 0) {
            Stack({ alignContent: Alignment.TopEnd }) {
              AppModalScrim({ onDismiss: () => this.closeOutline() })
                .opacity(this.outlineScrimOpacity)
              Column().width(this.isWide() ? 320 : '82%').height('100%')
                .backgroundColor($r('app.color.surface_soft'))
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
                .translate({ x: this.outlineOffset })
              this.compactOutlinePanel()
            }.width('100%').height('100%').zIndex(4)
          }
          if (this.workspaceTransition.snapshot &&
            (this.workspaceTransition.kind === 'module' || this.workspaceTransition.kind === 'document' ||
              this.workspaceTransition.kind === 'mode')) {
            Image(this.workspaceTransition.snapshot).width('100%').height('100%')
              .objectFit(ImageFit.Fill).syncLoad(true).opacity(this.workspaceTransition.opacity).zIndex(10)
              .onComplete(() => this.workspaceTransition.rendered())
              .onError(() => this.workspaceTransition.clear())
              .hitTestBehavior(HitTestMode.None)
          }
        }.id('module_frame').layoutWeight(1).width('100%')
        if (!this.isWide() && !this.softwareKeyboardVisible) {
          BottomNavigation({ selectedIndex: this.selectedTab(), onSelect: (index: number) => this.selectTab(index) })
        }
      }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
        .id('workspace_frame')
        .hitTestBehavior(this.readingTransition.animating ? HitTestMode.None : HitTestMode.Default)
        .onAreaChange((_oldArea: Area, area: Area) => {
          this.workspaceOriginX = Number(area.globalPosition.x);
          this.workspaceOriginY = Number(area.globalPosition.y);
        })
      DelayedLoadingHint({ loading: this.selectedTab() === 0 && this.logLoadingHint.loading,
        text: '正在读取日志…' })
        .width(this.logLoadingHint.width).height(this.logLoadingHint.height)
        .position({ x: this.logLoadingHint.x - this.workspaceOriginX,
          y: this.logLoadingHint.y - this.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedTab() === 3 && this.qaLoadingHint.loading,
        text: '正在读取会话…' })
        .width(this.qaLoadingHint.width).height(this.qaLoadingHint.height)
        .position({ x: this.qaLoadingHint.x - this.workspaceOriginX,
          y: this.qaLoadingHint.y - this.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedTab() === 1 && this.notesLoadingHint.loading,
        text: '正在加载随记…' })
        .width(this.notesLoadingHint.width).height(this.notesLoadingHint.height)
        .position({ x: this.notesLoadingHint.x - this.workspaceOriginX,
          y: this.notesLoadingHint.y - this.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedTab() === 2 && this.favoritesLoadingHint.loading,
        text: '正在加载收藏…' })
        .width(this.favoritesLoadingHint.width).height(this.favoritesLoadingHint.height)
        .position({ x: this.favoritesLoadingHint.x - this.workspaceOriginX,
          y: this.favoritesLoadingHint.y - this.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      DelayedLoadingHint({ loading: this.selectedTab() === 4 && !this.taxonomyOpen && this.statsLoadingHint.loading,
        text: '正在加载统计…' })
        .width(this.statsLoadingHint.width).height(this.statsLoadingHint.height)
        .position({ x: this.statsLoadingHint.x - this.workspaceOriginX,
          y: this.statsLoadingHint.y - this.workspaceOriginY })
        .zIndex(20).hitTestBehavior(HitTestMode.None)
      if (this.readingTransition.snapshot) {
        Stack({ alignContent: Alignment.TopStart }) {
          Image(this.readingTransition.snapshot).width(this.readingImageWidth).height(this.readingImageHeight)
            .constraintSize({ minWidth: this.readingImageWidth, minHeight: this.readingImageHeight })
            .objectFit(ImageFit.Fill).syncLoad(true).translate({ x: this.readingImageInset })
            .onComplete(() => this.readingTransition.rendered())
            .onError(() => this.readingTransition.clear())
        }.width(this.readingCoverWidth).height(this.readingCoverHeight)
          .position({ x: this.readingCoverX, y: this.readingCoverY })
          .backgroundColor($r('app.color.canvas')).clip(true).zIndex(5)
          .hitTestBehavior(HitTestMode.None)
      }
      if (this.readingOutlineOpen && this.logsReadingMode && this.isWide()) {
        Stack({ alignContent: Alignment.TopEnd }) {
          Column().width('100%').height('100%').onClick(() => this.readingOutlineOpen = false)
          Column() { this.desktopOutline() }
            .width(320).height(Math.min(560, 76 + this.outlineHeadings().length * 34))
            .margin({ top: 80, right: 16 })
            .backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') })
            .borderRadius(8).clip(true)
            .shadow({ radius: 18, color: $r('app.color.popover_shadow'), offsetY: 6 })
        }.width('100%').height('100%').zIndex(6)
          .transition(floatingSurfaceTransition())
      }
      if (!this.isWide() && this.taxonomyOpen) {
        TaxonomyManagerPage({
          onBack: () => this.confirmTaxonomyLeave(() => {}),
          onStateChange: (dirty: boolean, busy: boolean) => {
            this.taxonomyDirty = dirty; this.taxonomyBusy = busy;
          },
          onSaved: () => this.statsRefreshRevision++
        }).width('100%').height('100%').zIndex(7).transition(secondaryPageTransition())
      }
      if (!this.isWide() && this.navigationOpen) {
        Stack({ alignContent: Alignment.Start }) {
          AppModalScrim({ onDismiss: () => this.closeNavigation() })
            .opacity(this.navigationScrimOpacity)
          Row().width('82%').height('100%').backgroundColor($r('app.color.surface_soft'))
            .border({ width: { right: 1 }, color: $r('app.color.hairline') })
            .shadow({ radius: 18, color: '#24141413', offsetX: 4 })
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
            .translate({ x: this.navigationOffset })
          Column() {
            this.compactNavigationHeader()
            this.refreshableCompactNavigationContent()
          }.width('82%').height('100%')
            .backgroundColor($r('app.color.surface_soft'))
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
            .translate({ x: this.navigationOffset })
        }.width('100%').height('100%')
      }
      if (this.backupOpen && this.day) {
        Stack() {
          BackupPanel({ date: this.day.date, maximized: $backupMaximized,
            onClose: () => { if (!this.backupBusy) { this.backupOpen = false; this.backupMaximized = false; } },
            onBeforeRestore: () => this.beforeRestore(),
            onRestored: (day: DayEntry) => this.applyRestoredDay(day),
            onBusyChange: (busy: boolean) => this.backupBusy = busy })
            .width(this.isWide() ? (this.backupMaximized ? '100%' : '92%') : '100%')
            .constraintSize({ maxWidth: this.isWide() && !this.backupMaximized ? 1120 : '100%' })
            .height(this.isWide() ? (this.backupMaximized ? '100%' : '85%') : '100%')
            .borderRadius(this.isWide() && !this.backupMaximized ? 12 : 0)
            .clip(true)
        }.width('100%').height('100%')
          .backgroundColor($r('app.color.scrim'))
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      }
      if (this.linkOpen) {
        Stack() {
          EditorLinkPicker({ initialAlias: this.linkAlias,
            onClose: () => this.closeLink(),
            onInsert: (markup: string) => this.insertLink(markup) })
            .width(this.isWide() ? 680 : '100%')
            .height(this.isWide() ? 620 : '100%')
            .borderRadius(this.isWide() ? 12 : 0).clip(true)
        }.width('100%').height('100%')
          .backgroundColor($r('app.color.scrim'))
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      }
      if (this.favoriteGroupDialogOpen) {
        LogFavoriteGroupPanel({ data: this.favoritesData, favoriteId: this.favoriteGroupDialogId,
          wide: this.isWide(), onClose: () => this.favoriteGroupDialogOpen = false,
          onOpenFavorites: () => {
            this.favoriteGroupDialogOpen = false;
            this.closeOutline();
            this.selectTab(2);
          },
          onRemove: (favorite: FavoriteHeading) => this.removeOutlineFavorite(favorite) })
          .width('100%').height('100%').zIndex(12)
      }
      if (this.searchOpen && !this.isWide()) {
        LogSearchPanel({ query: this.searchQuery, headingsOnly: this.searchHeadingsOnly,
            ignoreCase: this.searchIgnoreCase, loading: this.searchLoading,
            submitted: this.searchSubmitted, error: this.searchError, results: this.searchResults,
            history: this.showSearchHistory() ? this.searchHistory : [],
            onHistorySelect: (query: string) => this.selectSearchHistory(query),
            onHistoryRemove: (query: string) => this.updateSearchHistory(
              this.searchHistory.filter((entry: string) => entry !== query)),
            onHistoryClear: () => this.updateSearchHistory([]),
          onClose: () => this.closeSearch(), onQuery: (query: string) => this.changeSearch(query),
          onSearch: () => this.searchLogs(),
          onHeadings: () => { this.searchHeadingsOnly = !this.searchHeadingsOnly; this.changeSearch(this.searchQuery); },
          onCase: () => { this.searchIgnoreCase = !this.searchIgnoreCase; this.changeSearch(this.searchQuery); },
          onSelect: (result: LogSearchResult) => this.selectSearchResult(result) })
          .width('100%').height('100%').transition(secondaryPageTransition())
      }
      if (this.ai.reviewOpen) {
        LogHighlightReview({ original: this.ai.originalDraft, highlighted: this.ai.highlighted,
          themePreference: this.themePreference,
          date: this.ai.highlightDate,
          available: this.ai.highlightDate === this.selectedDate && this.ai.originalDraft === this.draftText,
          onClose: () => this.ai.reviewOpen = false, onApply: () => this.applyAiHighlight() })
          .width('100%').height('100%').transition(floatingSurfaceTransition())
      }
    }.width('100%').height('100%')
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      .parallelGesture(PanGesture({ direction: PanDirection.All, distance: 6 })
        .onActionStart((event: GestureEvent) => this.handleOutlinePanStart(event))
        .onActionEnd((event: GestureEvent) => this.handleOutlinePanEnd(event))
        .onActionCancel(() => this.outlineGestureActive = false))
  }
}

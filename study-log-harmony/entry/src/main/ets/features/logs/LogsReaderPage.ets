import { AppModalFrame } from '../../common/ui/AppModalFrame';
import { WorkspaceSidebarState } from '../../app/WorkspaceSidebarState';
import { WorkspaceReadingState } from '../../app/WorkspaceReadingState';
import { WorkspaceBreakpoint, READING_MAX_WIDTH } from '../../common/AppConfig';
import { apiClient, ApiError, ApiUploadFile } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { EmptyState, LoadFailure } from '../../common/ui/FeedbackStates';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { SourceEditor, SourceEditorSession, EditorSnapshot, EditorImageData } from '../../common/editor/SourceEditor';
import { common } from '@kit.AbilityKit';
import { saveExport } from '../../common/files/DocumentExport';
import { EditorLinkPicker } from '../../common/editor/EditorLinkPicker';
import { DayEntry, DaySummary, LogSourceTarget } from './LogModels';
import { editableDayBody, matchesDeletedDay } from './LogDayBody';
import { LogSession } from './LogSession';
import { LogNavigationController } from './LogNavigationController';
import { LogDocumentController } from './LogDocumentController';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';
import { DesktopLogHeader } from './components/DesktopLogHeader';
import { ReadingLogHeader } from './components/ReadingLogHeader';
import { CompactLogHeader } from './components/CompactLogHeader';
import { BackupPanel } from './components/BackupPanel';
import { LogImageUpload } from './LogImageUpload';
import { LogSearchResult } from './LogSearchPanel';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { LogDisplayModeControl } from './components/LogDisplayModeControl';
import { ActionPanelHeader } from '../../common/ui/WorkspaceChrome';
import { workspaceKey } from '../../common/ui/WorkspaceKeys';
import { KeyCode, pointer } from '@kit.InputKit';
import { FrameAction } from '../../common/ui/FrameAction';
import { AppModalScrim } from '../../common/ui/AppModalScrim';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { floatingSurfaceTransition, revealPanel, secondaryPageTransition } from '../../common/ui/WorkspaceMotion';
import { DesktopLogCommands, DesktopMenuEntry } from '../../app/DesktopMenu';
import { iconTint } from '../../common/ui/IconTint';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { ToolbarDensity, resolveToolbarDensity, toolbarActionWidth, toolbarActionsWidth } from '../../common/ui/ToolbarLayout';
import { FavoritesController } from '../favorites/FavoritesController';
import { FavoriteHeading } from '../favorites/FavoriteModels';
import { LogFavoriteGroupPanel } from './components/LogFavoriteGroupPanel';
import { appFeedback } from '../../common/ui/AppFeedback';
import { WorkspaceSearchController } from '../../app/WorkspaceSearchController';
import { LogAiController } from './LogAiController';
import { LogAiMaterialImport } from './LogAiMaterialImport';
import { LogAiPanel } from './components/LogAiPanel';
import { LogHighlightReview } from './components/LogHighlightReview';
import { QaNavigationController } from '../qa/QaNavigationController';
import { WorkspaceNavigationView, WorkspaceNavigationCommands } from '../../app/WorkspaceNavigationBridge';
import { WorkspaceModuleState } from '../../app/WorkspaceModuleState';
import { PreservedLogDraft, restoredLogDraft } from './LogDraftPolicy';
import { WorkspaceTransitionCoordinator } from '../../app/WorkspaceTransitionCoordinator';
import { BackToTopControl } from '../../common/ui/BackToTopControl';

export { PreservedLogDraft } from './LogDraftPolicy';

interface LogOutlineHeading { id: string; text: string; level: number; }
interface AddFavoriteResponse { favorite: FavoriteHeading; }
interface AddFavoriteRequest { date: string; headingText: string; headingId: string; level: number; }

@Component
export struct LogsReaderPage {
  @Link selectedModule: number;
  @Prop desktopWindowChrome: boolean = false;
  @ObjectLink modules: WorkspaceModuleState;
  @Consume('workspaceBreakpoint') @Watch('workspaceBreakpointChanged')
  private workspaceBreakpoint: WorkspaceBreakpoint;
  @StorageLink('themePreference') private themePreference: string = 'system';
  onDraftChange: (namespace: string, draft: PreservedLogDraft | undefined) => void = () => {};
  onCaptureDraft: (capture: () => Promise<PreservedLogDraft | undefined>) => void = () => {};
  onRegisterDesktopCommands: (commands: DesktopLogCommands) => void = () => {};
  initialDraft: PreservedLogDraft | undefined = undefined;
  @ObjectLink session: LogSession;
  @ObjectLink logNavigation: LogNavigationController;
  @State private refreshing: boolean = false;
  @State private readFailed: boolean = false;
  @State private errorMessage: string = '';
  private retryRead: () => Promise<void> = async () => this.loadMonths();
  @State private outlineOpen: boolean = false;
  @State private outlineClosing: boolean = false;
  @State private outlineOffset: number = 340;
  @State private outlineScrimOpacity: number = 0;
  private outlineMotionRevision: number = 0;
  private pendingOutlineOpen: boolean = false;
  private outlineGestureActive: boolean = false;
  @ObjectLink qaNavigation: QaNavigationController;
  @ObjectLink favoritesData: FavoritesController;
  @State private favoriteBusy: boolean = false;
  @State private favoriteSuccessHeadingId: string = '';
  @State private favoriteDeleteId: string = '';
  @State private favoriteGroupDialogId: string = '';
  @State private favoriteGroupDialogOpen: boolean = false;
  private favoriteSuccessRevision: number = 0;
  private favoriteSuccessTimer: number = -1;
  @ObjectLink reading: WorkspaceReadingState;
  @ObjectLink sidebar: WorkspaceSidebarState;
  @Link logLoadingHint: LoadingHintPlacement;

  @State private readingOutlineOpen: boolean = false;
  @State private readerReady: boolean = false;
  @State private renderedPreviewDate: string = '';
  @State private previewOffset: number = 0;
  @State private previewProgress: number = 0;
  @State private previewTopRequest: number = 0;
  @State private previewRestoreOffset: number = 0;
  private previewScrollOffsets: Record<string, number> = {};
  @ObjectLink workspaceTransition: WorkspaceTransitionCoordinator;
  onRegisterNavigation: (view: WorkspaceNavigationView) => WorkspaceNavigationCommands = () => new WorkspaceNavigationCommands();
  onWorkspaceKey: (event: KeyEvent) => boolean = () => false;
  private navigationCommands: WorkspaceNavigationCommands = new WorkspaceNavigationCommands();
  @Link railPopover: string;

  private isDesktopNavigationCollapsed(): boolean { return this.sidebar.collapsedModules[this.selectedTab()]; }

  @State private targetHeading: string = '';
  @State private targetHeadingIndex: number = -1;
  @State private targetHeadingId: string = '';
  @State private targetKind: string = '';
  @State private targetQuery: string = '';
  @State private targetRevision: number = 0;
  @State private activeOutlineId: string = '';
  @State private outlineRequestRevision: number = 0;
  private desktopOutlineScroller: Scroller = new Scroller();
  @State private headerWidth: number = 600;
  @State private headerDateWidth: number = 190;
  @State private toolbarDensity: ToolbarDensity = ToolbarDensity.OVERFLOW;
  private toolbarMotionWidth: number = -1;
  @State private toolbarActionWidths: number[] = [];
  @State private sourceMode: boolean = false;
  @State private splitMode: boolean = false;
  @State private modeLayoutRevision: number = 0;
  private modeRequestRevision: number = 0;
  @State private editorReady: boolean = false;
  @State private previewText: string = '';
  @State private deleting: boolean = false;
  @State private backupOpen: boolean = false;
  @State private backupMaximized: boolean = false;
  @State private backupBusy: boolean = false;
  @State private linkOpen: boolean = false;
  @State private linkOpening: boolean = false;
  @State private imageBusy: boolean = false;
  @State private pendingImageCount: number = 0;
  private pendingImageFiles: ApiUploadFile[] = [];
  private pendingImageDate: string = '';
  @State private exportBusy: boolean = false;
  @State private exportMenuOpen: boolean = false;
  @State private hoveredExport: string = '';
  @Link searchOpen: boolean;
  @ObjectLink search: WorkspaceSearchController;
  @Link searchFocusRevision: number;
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
  @State private linkAlias: string = '';
  @State private moreOpen: boolean = false;
  @Link topMoreOpen: boolean;
  @Link desktopThemeOpen: boolean;
  @Link desktopKeyboardFocus: boolean;
  @Link compactSettingsOpen: boolean;
  @State private hoveredMoreAction: string = '';
  @State private saveError: string = '';
  @Link newLogDate: string;
  @Link calendarMode: string;
  @Link calendarOpen: boolean;
  private reads: LogReadRepository = new LogReadRepository(apiClient);
  private writes: LogWriteRepository = new LogWriteRepository(apiClient);
  @State private documents: LogDocumentController = new LogDocumentController(this.session, this.reads, this.writes);
  private editor: SourceEditorSession = new SourceEditorSession();
  private lifecycle: number = 0;
  private restoredDraftApplied: boolean = false;
  private leaveCheckPending: boolean = false;
  private linkTarget: EditorSnapshot | undefined = undefined;
  logNavigationScroller: Scroller = new Scroller();

  private bindWorkspaceNavigation(): void {
    this.navigationCommands = this.onRegisterNavigation({
      selectLogMonth: (month: string) => { if (month !== this.logNavigation.month) this.confirmDiscard(() => this.loadDays(month)); },
      selectLogDay: (date: string) => {
        if (date !== this.session.selectedDate || this.documents.dayRequestLoading) this.confirmDiscard(() => this.loadDay(date));
      },
      selectLogHeading: (day: DaySummary, heading: string, index: number) => this.openHeading(day, heading, index),
      selectLogDate: (date: string) => this.confirmDiscard(() => this.openDate(date, false)),
      createLog: (date: string) => this.openNewLog(date),
      retryLogNavigation: () => { if (this.logNavigation.month) this.loadDays(this.logNavigation.month); else this.loadMonths(); },
      closeLogMenu: () => this.moreOpen = false,
      workspaceAreaChanged: (area: Area) => {
        this.aiAvailableWidth = Number(area.width);
        this.resizeAiPanel(this.aiWidthAdjusted ? this.aiPanelWidth : 340);
        if (this.isWide() && this.aiOpen && !this.aiClosing && !this.aiAnimating && this.aiOffset === 420) this.moveAiTools(0);
      },

      openLogSource: (target: LogSourceTarget) => this.openLogSource(target),
      openLogDatePicker: (mode: string) => this.openCalendar(mode),
      currentLogDate: () => this.session.selectedDate,
      hasLog: () => !!this.session.day,
      isLogOutlineOpen: () => this.outlineOpen,
      isReading: () => this.reading.logsReadingMode,
      canRead: (active: boolean) => !!this.session.day && !this.sourceMode && !this.splitMode && !this.sidebar.sidebarAnimating &&
        (!active || this.renderedPreviewDate === this.session.selectedDate),
      beforeReading: () => this.readingOutlineOpen = false,
      canMoveSidebar: () => !this.aiAnimating,
      beginSidebarMotion: (width: number) => this.beginToolbarMotion(this.aiAvailableWidth - width -
        (52 + (this.aiPanelWidth - 52) * (1 - this.aiOffset / 420))),
      advanceSidebarMotion: (widths: number[][], progress: number) => this.advanceToolbarMotion(widths, progress),
      finishSidebarMotion: () => { if (!this.aiAnimating) this.finishToolbarMotion(); },
      scrollSidebar: (section: number): void => { this.logNavigationScroller.scrollToIndex(section, false, ScrollAlign.START); },
      isDocumentReady: (date: string) => this.isLogDocumentReady(date),
      confirmLogLeave: (action: () => void) => this.confirmDiscard(action),
      leaveLog: () => {
        this.readingOutlineOpen = false;
        this.session.text = this.session.baseline;
        this.session.editorInitialText = this.session.baseline;
        this.previewText = this.session.baseline;
      },
      closeNavigation: () => { this.closeNavigation(); this.railPopover = ''; },
      changed: (index: number) => {
        this.finishToolbarMotion();
        if (index === 0 && this.readFailed) this.showReadFailure();
        else if (index !== 0) appFeedback.dismissScope('log-read');
        this.closeNavigation();
        if (index !== 0) this.closeOutline();
        this.closeSearch();
      }
    });
  }

  private requestModule(index: number, discardNotes: boolean = false, discardQa: boolean = false,
    afterSwitch: () => void = () => {}, targetDate: string = ''): void {
    this.navigationCommands.request(index, discardNotes, discardQa, afterSwitch, targetDate);
  }

  private openTaxonomy(): void { this.navigationCommands.openTaxonomy(); }
  private confirmNotesLeave(action: () => void): void { this.navigationCommands.notesLeave(action); }
  private confirmQaLeave(action: () => void): void { this.navigationCommands.qaLeave(action); }
  private confirmTaxonomyLeave(action: () => void): void { this.navigationCommands.taxonomyLeave(action); }
  private logDocumentReady(date: string): void { this.navigationCommands.ready(date); }
  private logNavigationFailed(date: string): void { this.navigationCommands.failed(date); }

  private bindNavigation(): void {
    this.logNavigation.bind(this.reads, {
      lifecycle: () => this.lifecycle,
      restoreDate: () => this.initialDraft?.namespace === activeInstance.namespace ? this.initialDraft.date : '',
      beforeRead: () => appFeedback.dismissScope('log-read'),
      readingStarted: (months: boolean) => { this.readFailed = false; if (months) this.errorMessage = ''; },
      beforeChange: async () => { this.documents.dayLoadRevision++; await this.coverLogDocument(); },
      openDay: async (date: string) => this.loadDay(date),
      documentFailed: () => !!this.errorMessage && !!this.session.day,
      clearDocument: () => this.session.clearDocument(),
      emptyDayList: () => {
        this.readerReady = false; this.renderedPreviewDate = '';
        this.workspaceTransition.finish('document');
      },
      finishTransition: () => this.workspaceTransition.finish('document'),
      message: (error: Error) => this.message(error),
      setRetry: (retry: () => Promise<void>) => this.retryRead = retry,
      failed: (message: string, retry: () => Promise<void>) => {
        this.readFailed = true; this.errorMessage = message; this.retryRead = retry; this.showReadFailure();
        this.logNavigationFailed(this.modules.pendingLogDate);
      }
    });
  }

  private bindDocuments(): void {
    this.documents.bind({
      locked: () => !this.editorReady || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy,
      lifecycle: () => this.lifecycle,
      flushEditor: () => this.editor.command('snapshot'),
      draftChanged: () => this.reportDraft(),
      saved: (day: DayEntry, text: string, date: string) => this.acceptSavedDay(day, text, date),
      notice: (message: string) => this.saveError = message,
      beforeRead: () => {
        appFeedback.dismissScope('log-read');
        this.closeFavoriteFeedback();
        this.favoriteGroupDialogOpen = false;
      },
      beforeChange: () => this.coverLogDocument(),
      readingStarted: () => { this.readFailed = false; this.errorMessage = ''; },
      installed: (day: DayEntry, date: string, heading: string, headingIndex: number) =>
        this.installDay(day, date, heading, headingIndex),
      failed: (date: string, heading: string, headingIndex: number, error: Error) => {
        this.readFailed = true;
        this.errorMessage = this.message(error);
        this.retryRead = async () => this.loadDay(date, heading, headingIndex);
        this.showReadFailure();
        this.workspaceTransition.finish('document');
        this.logNavigationFailed(date);
      },
      readFinished: (date: string, revision: number, lifecycle: number) => {
        if ((this.sourceMode || this.splitMode && !this.isWide()) && this.editor.loadedDocumentKey === date) {
          this.getUIContext().postFrameCallback(new FrameAction(() => {
            if (lifecycle === this.lifecycle && revision === this.documents.dayLoadRevision) {
              this.workspaceTransition.finish('document');
              this.logDocumentReady(date);
            }
          }));
        }
      }
    });
  }

  aboutToAppear(): void {
    this.bindWorkspaceNavigation();
    this.bindDocuments();
    this.bindNavigation();
    this.lifecycle++;
    const commands = new DesktopLogCommands();
    commands.entries = (menu: string): DesktopMenuEntry[] => {
      const logActive = this.selectedTab() === 0;
      const ready = logActive && !!this.session.day && !this.documents.dayRequestLoading && !this.logNavigation.daysLoading &&
        !this.documents.saving && !this.deleting && !this.exportBusy && !this.imageBusy && !this.backupOpen && !this.linkOpen;
      const editing = ready && this.editorReady && (this.sourceMode || this.splitMode);
      if (menu === '文件') return [
        new DesktopMenuEntry('newLog', '新建日志…', true, false, 'Ctrl+Alt+N'),
        new DesktopMenuEntry('save', '保存当前日志', ready && this.session.isDirty(), false, 'Ctrl+S'),
        new DesktopMenuEntry('export-day', '导出当前日块', ready && !!this.session.day?.exists),
        new DesktopMenuEntry('export-file', '导出当前源文件', ready && !!this.session.day?.exists),
        new DesktopMenuEntry('export-all', '导出全部日志', logActive && !this.exportBusy),
        new DesktopMenuEntry('backup', '备份与恢复', ready && !!this.session.day?.exists)
      ];
      if (menu === '编辑') return [
        new DesktopMenuEntry('undo', '撤销', editing, false, 'Ctrl+Z'),
        new DesktopMenuEntry('redo', '重做', editing, false, 'Ctrl+Shift+Z'),
        new DesktopMenuEntry('find', '查找与替换', ready, false, 'Ctrl+F')
      ];
      if (menu === '视图') return [
        new DesktopMenuEntry('sidebar', '左侧导航', this.isWide() && !this.reading.logsReadingMode,
          !this.isDesktopNavigationCollapsed()),
        new DesktopMenuEntry('reading', '阅读模式', this.selectedTab() === 0 && !!this.session.day &&
          !this.sourceMode && !this.splitMode, this.reading.logsReadingMode),
        new DesktopMenuEntry('preview', '浏览', ready, !this.sourceMode && !this.splitMode),
        new DesktopMenuEntry('source', '源码', ready, this.sourceMode),
        new DesktopMenuEntry('split', '分屏', ready, this.splitMode)
      ];
      return [];
    };
    commands.execute = (id: string): void => {
      if (!['文件', '编辑', '视图'].flatMap((menu: string) => commands.entries(menu))
        .some((entry: DesktopMenuEntry) => entry.id === id && entry.enabled)) return;
      if (id === 'newLog') this.requestModule(0, false, false, () => this.openCalendar('create'));
      else if (id.startsWith('export-')) this.exportLogs(id.slice('export-'.length));
      else if (id === 'backup') this.backupOpen = true;
      else if (id === 'save') this.save();
      else if (id === 'undo' || id === 'redo') {
        this.editor.command(id).catch((error: Error) => this.saveError = error.message);
      }
      else if (id === 'find') this.findInEditor();
      else if (id === 'sidebar') this.setDesktopNavigationCollapsed(!this.isDesktopNavigationCollapsed());
      else if (id === 'reading') this.setLogsReadingMode(!this.reading.logsReadingMode);
      else if (id === 'preview') this.switchMode(false);
      else if (id === 'source') this.switchMode(true);
      else if (id === 'split') this.switchMode(false, true);
    };
    commands.handleKey = (event: KeyEvent): boolean => this.handleLogKey(event);
    commands.closeMenu = (): boolean => this.closeShortcutMenu();
    commands.closeOutline = (): boolean => this.closeShortcutOutline();
    commands.editing = (): boolean => this.sourceMode || this.splitMode;
    commands.editorFocused = (): boolean => (this.sourceMode || this.splitMode) && this.editor.focused;
    commands.blocked = (): boolean => this.logShortcutBlocked();
    commands.navigate = (offset: number): void => {
      if (!this.sourceMode && !this.splitMode && !this.documents.dayRequestLoading && !this.logNavigation.daysLoading) this.navigateDay(offset);
    };
    this.onRegisterDesktopCommands(commands);
    this.onCaptureDraft(() => this.captureDraft());
    this.editor.onReadyChange = (ready: boolean) =>
      this.editorReady = ready && this.editor.loadedDocumentKey === this.session.selectedDate;
    this.editor.onDocumentLoaded = (documentKey: string) => {
      if (documentKey !== this.session.selectedDate) return;
      this.editorReady = true;
      if (!(this.sourceMode || this.splitMode && !this.isWide())) return;
      this.getUIContext().postFrameCallback(new FrameAction(() => {
        if (documentKey === this.session.selectedDate && (this.sourceMode || this.splitMode && !this.isWide())) {
          this.workspaceTransition.finish('mode');
          this.workspaceTransition.finish('document');
          this.logDocumentReady(documentKey);
        }
      }));
    };
    this.editor.onChange = (snapshot: EditorSnapshot) => {
      if (snapshot.documentKey !== this.session.selectedDate) return;
      this.session.text = snapshot.text;
      this.session.editorPending = false;
      if (this.splitMode) this.previewText = snapshot.text;
      this.reportDraft();
    };
    this.editor.onDirty = (key: string) => {
      if (key === this.session.selectedDate) { this.session.editorPending = true; this.reportDraft(); }
    };
    this.editor.onFailure = (message: string) => {
      this.saveError = message;
      if (this.sourceMode || this.splitMode && !this.isWide()) {
        this.workspaceTransition.finish('mode');
        this.workspaceTransition.finish('document');
        this.logNavigationFailed(this.session.selectedDate);
      }
    };
    this.editor.onCommand = (command: string) => {
      if (command === 'save') this.save();
      else if (command === 'globalSearch' && !this.shortcutBlocked()) {
        this.searchOpen = true;
        this.searchFocusRevision++;
      } else if (command === 'internalLink' && !this.shortcutBlocked()) this.openLink();
      else if (['help', 'focusNext', 'focusPrevious', 'menuFocus', 'newLog', 'newQa'].includes(command)) {
        this.navigationCommands.editorCommand(command);
      }
    };
    this.editor.onImages = (target: EditorSnapshot, images: EditorImageData[]) => this.receiveImages(target, images);
    this.loadMonths();
  }

  aboutToDisappear(): void {
    this.documents.dispose();
    this.closeFavoriteFeedback();
    this.onRegisterDesktopCommands(new DesktopLogCommands());
    this.navigationCommands.dispose();
    this.modeRequestRevision++;
    this.ai.dispose();
    this.lifecycle++;
    this.reads.invalidate();
    this.editor.onChange = () => {};
    this.editor.onDirty = () => {};
    this.editor.onFailure = () => {};
    this.editor.onReadyChange = () => {};
    this.editor.onDocumentLoaded = () => {};
    this.editor.onCommand = () => {};
    this.editor.onImages = () => {};
    this.closeLink(false);
    this.cancelPendingImages();
    this.onCaptureDraft(async () => undefined);
  }

  private isWide(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private selectedTab(): number {
    return this.selectedModule;
  }

  private openCurrentSearch(): void { this.navigationCommands.openSearch(); }

  private logShortcutBlocked(): boolean {
    return this.backupOpen || this.linkOpen || this.ai.reviewOpen || this.imageBusy || this.exportBusy ||
      this.documents.saving || this.deleting || this.moreOpen || this.exportMenuOpen || this.outlineOpen;
  }

  private shortcutBlocked(): boolean {
    return this.backupOpen || this.linkOpen || this.ai.reviewOpen || this.imageBusy || this.exportBusy ||
      this.documents.saving || this.deleting || this.modules.taxonomyOpen || this.desktopThemeOpen || this.topMoreOpen || this.compactSettingsOpen || this.moreOpen ||
      this.exportMenuOpen || this.calendarOpen || !!this.railPopover || (!this.isWide() && this.searchOpen) ||
      this.sidebar.navigationOpen || this.outlineOpen || !!this.qaNavigation.qaRenameId || !!this.qaNavigation.qaMenuId;
  }

  private closeShortcutMenu(): boolean {
    if (this.moreOpen) this.moreOpen = false;
    else if (this.exportMenuOpen) this.exportMenuOpen = false;
    else return false;
    return true;
  }

  private closeShortcutOutline(): boolean {
    if (this.readingOutlineOpen) this.readingOutlineOpen = false;
    else if (this.outlineOpen) this.closeOutline();
    else return false;
    return true;
  }

  private handleLogKey(event: KeyEvent): boolean {
    if (this.shortcutBlocked() || this.selectedModule !== 0) return false;
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_UP, false, false, true)) {
      this.previewTopRequest++;
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_S, true)) {
      this.save();
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_F, true) && (this.sourceMode || this.splitMode)) {
      this.editor.command('find');
      return true;
    }
    if (!this.sourceMode && !this.splitMode) {
      if (workspaceKey(event, KeyCode.KEYCODE_DPAD_LEFT, false, false, true)) {
        if (!this.documents.dayRequestLoading && !this.logNavigation.daysLoading) this.navigateDay(1);
        return true;
      }
      if (workspaceKey(event, KeyCode.KEYCODE_DPAD_RIGHT, false, false, true)) {
        if (!this.documents.dayRequestLoading && !this.logNavigation.daysLoading) this.navigateDay(-1);
        return true;
      }
    }
    return false;
  }

  private async setLogsReadingMode(active: boolean): Promise<void> { await this.navigationCommands.readingMode(active); }

  private workspaceBreakpointChanged(): void {
    this.closeNavigation();
    if (this.isWide()) return;
    this.readingOutlineOpen = false;
    this.topMoreOpen = false;
    this.desktopThemeOpen = false;
  }

  private readingViewportChanged(area: Area): void { this.navigationCommands.readingViewport(area); }

  private openNavigation(): void { this.navigationCommands.navigation(true); }

  private closeNavigation(): void {
    this.railPopover = '';
    this.navigationCommands.navigation(false);
  }

  private openOutline(): void {
    const headings = this.outlineHeadings();
    if (this.outlineOpen || this.sidebar.navigationOpen || headings.length === 0) return;
    this.favoritesData.load();
    const revision = ++this.outlineMotionRevision;
    const lifecycle = this.lifecycle;
    if (!this.readerReady || this.sourceMode) this.activeOutlineId = headings[0].id;
    if (!this.sourceMode && this.readerReady) this.outlineRequestRevision++;
    this.outlineClosing = false;
    this.outlineOffset = 340;
    this.outlineScrimOpacity = 0;
    this.outlineOpen = true;
    revealPanel(this.getUIContext(), () => lifecycle === this.lifecycle && revision === this.outlineMotionRevision &&
      this.outlineOpen && !this.outlineClosing, () => {
      this.outlineOffset = 0;
      this.outlineScrimOpacity = 1;
    });
  }

  private closeOutline(): void {
    if (!this.outlineOpen || this.outlineClosing) return;
    const revision = ++this.outlineMotionRevision;
    const lifecycle = this.lifecycle;
    this.outlineClosing = true;
    animateTo({ duration: 180, curve: Curve.EaseIn, onFinish: () => {
      if (lifecycle !== this.lifecycle || revision !== this.outlineMotionRevision) return;
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
    if (this.isWide() || this.selectedTab() !== 0 || this.sidebar.navigationOpen || this.sourceMode ||
      !this.session.day || !this.readerReady || this.outlineOpen || this.moreOpen || this.aiOpen ||
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
    if (index === this.selectedTab() && this.modules.moduleRequestedTab < 0) return;
    this.requestModule(index);
  }

  private isLogDocumentReady(date: string): boolean {
    if (date !== this.session.selectedDate) return false;
    return this.sourceMode || this.splitMode && !this.isWide() ?
      this.editorReady && this.editor.loadedDocumentKey === date :
      this.readerReady && this.renderedPreviewDate === date;
  }

  private async openLogSource(target: LogSourceTarget): Promise<void> {
    await this.loadTargetDate(target.date, () => {
      this.targetHeading = target.heading;
      this.targetHeadingIndex = target.headingIndex;
      this.targetHeadingId = target.headingId;
      this.targetKind = target.kind;
      this.targetQuery = target.query || '';
      this.targetRevision++;
    });
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
    return this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE && !this.reading.logsReadingMode && !this.sourceMode &&
      !this.splitMode && this.outlineHeadings().length > 0;
  }

  private outlineHeadings(): LogOutlineHeading[] {
    const headings: LogOutlineHeading[] = [];
    const used: Map<string, number> = new Map<string, number>();
    let inFence = false;
    (this.sourceMode ? this.session.text : this.previewText).split('\n').forEach((line: string) => {
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
    const headings = this.outlineHeadings();
    const index = headings.findIndex((heading: LogOutlineHeading) => heading.id === headingId);
    if (index < 0 || this.activeOutlineId === headingId) return;
    this.activeOutlineId = headingId;
    if (this.showDesktopOutline()) {
      const lifecycle = this.lifecycle;
      const date = this.session.selectedDate;
      const revision = this.documents.dayLoadRevision;
      setTimeout((): void => {
        if (lifecycle !== this.lifecycle || date !== this.session.selectedDate ||
          revision !== this.documents.dayLoadRevision || headingId !== this.activeOutlineId ||
          !this.showDesktopOutline()) return;
        this.desktopOutlineScroller.scrollToIndex(index, true, ScrollAlign.AUTO);
      }, 0);
    }
  }

  private locateOutlineHeading(heading: LogOutlineHeading): void {
    this.closeOutline();
    this.readingOutlineOpen = false;
    this.activeOutlineId = heading.id;
    this.targetHeading = heading.text;
    this.targetHeadingIndex = this.outlineHeadings().findIndex((item: LogOutlineHeading) => item.id === heading.id);
    this.targetHeadingId = '';
    this.targetKind = 'outline';
    this.targetQuery = '';
    this.targetRevision++;
  }

  private outlineFavorite(heading: LogOutlineHeading): FavoriteHeading | undefined {
    return this.favoritesData.favorites.find((item: FavoriteHeading) =>
      item.date === this.session.selectedDate && (item.resolvedHeadingId || item.headingId) === heading.id);
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
    if (!this.session.selectedDate || this.favoriteBusy) return;
    const date = this.session.selectedDate;
    const lifecycle = this.lifecycle;
    this.favoriteBusy = true;
    try {
      const request: AddFavoriteRequest = {
        date: this.session.selectedDate, headingText: heading.text, headingId: heading.id, level: heading.level
      };
      const response = await apiClient.post<AddFavoriteResponse>('/favorites', request);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
      appFeedback.dismissScope('favorite-add');
      this.favoritesData.favorites = [...this.favoritesData.favorites, response.favorite];
      this.favoriteDeleteId = '';
      this.favoriteSuccessHeadingId = heading.id;
      const revision = ++this.favoriteSuccessRevision;
      if (this.favoriteSuccessTimer >= 0) clearTimeout(this.favoriteSuccessTimer);
      this.favoriteSuccessTimer = setTimeout(() => {
        if (lifecycle === this.lifecycle && revision === this.favoriteSuccessRevision &&
          date === this.session.selectedDate && this.favoriteSuccessHeadingId === heading.id) {
          this.favoriteSuccessTimer = -1;
          this.favoriteSuccessHeadingId = '';
        }
      }, 5200);
    } catch (error) {
      if (lifecycle === this.lifecycle && date === this.session.selectedDate)
        appFeedback.show(error instanceof ApiError ? error.message : '收藏失败', 'error', 3600, 'favorite-add');
    } finally { if (lifecycle === this.lifecycle) this.favoriteBusy = false; }
  }

  private async removeOutlineFavorite(favorite: FavoriteHeading): Promise<void> {
    if (this.favoriteBusy) return;
    this.favoriteBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    const removed = await this.favoritesData.remove(favorite.id);
    if (lifecycle === this.lifecycle) this.favoriteBusy = false;
    if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
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

  private showReadFailure(): void {
    if (this.session.day && this.selectedTab() === 0) appFeedback.show(this.errorMessage, 'error', 0, 'log-read',
      { label: '重试', onAction: () => this.retryRead() });
  }

  private reportDraft(): void {
    const namespace = activeInstance.namespace;
    this.onDraftChange(namespace, this.session.isDirty() && this.session.selectedDate ? {
      namespace, date: this.session.selectedDate, text: this.session.text, baseVersion: this.session.baseVersion
    } : undefined);
  }

  private async captureDraft(): Promise<PreservedLogDraft | undefined> {
    if (!this.session.selectedDate) return undefined;
    let text = this.session.text;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey === this.session.selectedDate) text = snapshot.text;
      } catch (_) { /* Keep the last observed draft if the editor is closing. */ }
    }
    return text !== this.session.baseline ? { namespace: activeInstance.namespace, date: this.session.selectedDate,
      text, baseVersion: this.session.baseVersion } : undefined;
  }

  private bodyFromDay(day: DayEntry): string {
    return editableDayBody(day);
  }

  private confirmDiscard(next: () => void): void {
    if (this.modules.taxonomyOpen) { this.confirmTaxonomyLeave(() => this.confirmDiscard(next)); return; }
    if (this.leaveCheckPending) return;
    this.leaveCheckPending = true;
    this.checkBeforeLeaving(next).finally(() => this.leaveCheckPending = false);
  }

  private async checkBeforeLeaving(next: () => void): Promise<void> {
    if (this.documents.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) {
      this.saveError = '操作进行中，请稍候'; return;
    }
    if (this.session.day && this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.session.selectedDate) return;
        this.session.text = snapshot.text;
        this.session.editorPending = false;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    if (!this.session.isDirty()) { next(); return; }
    if (!this.editorReady) { this.saveError = '编辑器尚未就绪，请稍后重试'; return; }
    AlertDialog.show({ message: '当前日志修改尚未保存，是否放弃修改？', autoCancel: false,
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.discardDraft().then(() => { if (!this.session.isDirty()) next(); });
      } }
    });
  }

  private async switchMode(source: boolean, split: boolean = false): Promise<void> {
    const revision = ++this.modeRequestRevision;
    if (source === this.sourceMode && split === this.splitMode) return;
    if (this.editorReady && this.session.day) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.session.selectedDate) return;
        this.session.text = snapshot.text;
        this.session.editorPending = false;
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
    if (this.isWide() && this.session.day && this.selectedTab() === 0) {
      this.workspaceTransition.clear();
      await this.workspaceTransition.cover('mode');
      if (revision !== this.modeRequestRevision) return;
    }
    this.sourceMode = source;
    this.splitMode = split;
    this.updateToolbarWidth(this.headerWidth);
    this.modeLayoutRevision++;
    if (!this.session.day || this.documents.dayRequestLoading || this.logNavigation.daysLoading ||
      (source && this.editor.loadedDocumentKey === this.session.selectedDate)) {
      this.getUIContext().postFrameCallback(new FrameAction(() => {
        if (revision === this.modeRequestRevision) this.workspaceTransition.finish('mode');
      }));
    }
  }

  private acceptSavedDay(day: DayEntry, submittedText: string, date: string): void {
    this.session.acceptSaved(day, submittedText);
    this.reportDraft();
    this.previewText = this.session.text;
    this.reads.invalidate();
    this.refreshNavigation(date);
    appFeedback.show('日志已保存', 'success');
  }

  private async save(): Promise<void> { await this.documents.save(); }

  private async refreshNavigation(date: string): Promise<void> {
    const lifecycle = this.lifecycle;
    const month = date.slice(0, 7);
    try {
      const result = await Promise.all([this.reads.months(), this.reads.days(month)]);
      if (lifecycle !== this.lifecycle) return;
      this.logNavigation.months = result[0].months;
      if (this.logNavigation.month === month && this.session.selectedDate === date) {
        this.logNavigation.days = result[1].days;
        this.logNavigation.navigationError = '';
      }
    } catch (error) {
      if (lifecycle === this.lifecycle && this.logNavigation.month === month && this.session.selectedDate === date) {
        this.logNavigation.navigationError = this.message(error as Error);
      }
    }
  }

  private async beforeRestore(): Promise<boolean> {
    if (!this.session.day || !this.backupOpen) return false;
    if (this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.session.selectedDate) return false;
      this.session.text = snapshot.text;
      this.session.editorPending = false;
      this.reportDraft();
    }
    return new Promise<boolean>((resolve) => {
      AlertDialog.show({ title: '恢复此版本', autoCancel: false,
        message: `仅恢复 ${this.session.selectedDate} 日块，恢复前会再次保留现有文件。` +
          (this.session.isDirty() ? '\n当前编辑器有未保存修改，恢复会放弃这些修改。' : ''),
        primaryButton: { value: '取消', action: () => resolve(false) },
        secondaryButton: { value: '恢复', action: () => resolve(true) },
        cancel: () => resolve(false) });
    });
  }

  private async applyRestoredDay(day: DayEntry): Promise<void> {
    if (day.date !== this.session.selectedDate) return;
    this.cancelPendingImages();
    const body = this.bodyFromDay(day);
    if (this.editor.ready && this.editor.documentKey === day.date) {
      await this.editor.replace(body, true);
    }
    if (day.date !== this.session.selectedDate) return;
    this.session.commitDocument(day, body);
    this.previewText = body;
    this.reportDraft();
    this.sourceMode = false;
    this.splitMode = false;
    this.saveError = '';
    this.reads.invalidate();
    this.refreshNavigation(day.date);
    this.backupOpen = false;
    appFeedback.show('备份已恢复', 'success');
  }

  private async openLink(): Promise<void> {
    if (!this.session.day || !this.editorReady || this.linkOpen || this.linkTarget || this.linkOpening || this.backupOpen) return;
    this.moreOpen = false;
    this.linkOpening = true;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    let target: EditorSnapshot | undefined = undefined;
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      target = await this.editor.command('capture');
      if (lifecycle !== this.lifecycle || target.documentKey !== date) return;
      await this.editor.command('blur');
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
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
    if (!target || !this.linkOpen || target.documentKey !== this.session.selectedDate) throw new Error('插入位置已变化，请重新打开');
    await this.editor.insert(target, markup);
    this.closeLink();
  }

  private closeLink(refocus: boolean = true): void {
    this.linkOpen = false;
    if (!refocus) this.finishLink(false);
  }

  private finishLink(refocus: boolean = true): void {
    const lifecycle = this.lifecycle;
    const target = this.linkTarget;
    this.linkTarget = undefined;
    if (!target) return;
    this.editor.release(target).then(() => {
      if (refocus && lifecycle === this.lifecycle && this.editorReady && target.documentKey === this.session.selectedDate) {
        this.editor.command('focus').catch(() => {});
      }
    }).catch(() => {});
  }

  private imageUpload(): LogImageUpload {
    return new LogImageUpload(this.getUIContext().getHostContext() as common.UIAbilityContext);
  }

  private cancelPendingImages(): void {
    this.imageUpload().clear(this.pendingImageFiles);
    this.pendingImageFiles = [];
    this.pendingImageDate = '';
    this.pendingImageCount = 0;
  }

  private async receivePreviewImages(event: DragEvent): Promise<void> {
    if (!this.session.day || this.documents.dayRequestLoading || this.logNavigation.daysLoading || this.documents.saving || this.deleting ||
      this.imageBusy || this.pendingImageCount || this.backupOpen || this.linkOpen) {
      appFeedback.show('请先完成当前图片或编辑操作', 'warning');
      return;
    }
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    this.imageBusy = true;
    try {
      const files = this.imageUpload().receiveDrop(event);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) {
        this.imageUpload().clear(files);
        return;
      }
      this.pendingImageFiles = files;
      this.pendingImageDate = date;
      this.pendingImageCount = files.length;
      await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate || !this.sourceMode) {
        this.cancelPendingImages();
        throw new Error('未能进入原日志编辑，请重新拖入图片');
      }
    } catch (error) {
      if (this.pendingImageDate === date && !this.sourceMode) this.cancelPendingImages();
      if (lifecycle === this.lifecycle) appFeedback.show(
        error instanceof Error ? error.message : '未能读取拖入的图片', 'error');
    } finally {
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private async insertPendingImages(): Promise<void> {
    if (!this.pendingImageCount || this.imageBusy) return;
    if (!this.session.day || this.pendingImageDate !== this.session.selectedDate || !this.sourceMode ||
      !this.editorReady || this.editor.loadedDocumentKey !== this.session.selectedDate) {
      appFeedback.show('日块或编辑模式已变化，请重新插入图片', 'error');
      return;
    }
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    let target: EditorSnapshot | undefined = undefined;
    try {
      target = await this.editor.command('capture');
      if (target.documentKey !== date) throw new Error('编辑位置已变化，请重新插入图片');
      const markdown = await this.imageUpload().upload(this.pendingImageFiles);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
      const before = target.text.slice(0, target.from);
      const after = target.text.slice(target.to);
      const prefix = before ? (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') : '';
      const suffix = after ? (after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n') : '';
      await this.editor.insert(target, `${prefix}${markdown}${suffix}`);
      this.cancelPendingImages();
    } catch (error) {
      if (lifecycle === this.lifecycle) appFeedback.show(
        error instanceof Error ? error.message : '图片上传失败，可重试', 'error');
    } finally {
      if (target) this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private async insertImages(): Promise<void> {
    if (!this.session.day || this.imageBusy || this.linkOpen || this.backupOpen) return;
    this.moreOpen = false;
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    const uploader = this.imageUpload();
    let target: EditorSnapshot | undefined = undefined;
    let files: ApiUploadFile[] = [];
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      for (let attempt = 0; attempt < 50 && this.editor.loadedDocumentKey !== date; attempt += 1) {
        if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (this.editor.loadedDocumentKey !== date) throw new Error('编辑器尚未就绪，请稍后重试');
      target = await this.editor.command('capture');
      files = await uploader.pick();
      if (!files.length || lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
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
    if (this.imageBusy || this.linkOpen || this.backupOpen || !this.session.day || target.documentKey !== this.session.selectedDate) {
      this.editor.release(target).catch(() => {});
      return;
    }
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    const uploader = this.imageUpload();
    let files: ApiUploadFile[] = [];
    try {
      files = await uploader.paste(images);
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
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
    if (this.session.day && this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.session.selectedDate) return false;
      this.session.text = snapshot.text;
      this.session.editorPending = false;
      this.reportDraft();
    }
    if (!this.session.isDirty()) return true;
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
    if (this.exportBusy || this.imageBusy || this.documents.saving || this.deleting || this.linkOpen ||
      (scope !== 'all' && !this.session.selectedDate)) return;
    const lifecycle = this.lifecycle;
    const date = this.session.selectedDate;
    this.exportBusy = true;
    this.saveError = '';
    try {
      if (!await this.confirmSavedExport() || lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
      const query = scope === 'all' ? '' : `&date=${encodeURIComponent(date)}`;
      const data = await apiClient.download(`/export?scope=${scope}${query}`);
      if (lifecycle !== this.lifecycle || date !== this.session.selectedDate) return;
      const exported = await saveExport(this.getUIContext().getHostContext() as common.UIAbilityContext,
        this.exportName(scope, date), data,
        () => lifecycle === this.lifecycle && date === this.session.selectedDate);
      if (exported && lifecycle === this.lifecycle && date === this.session.selectedDate) {
        appFeedback.show('日志已导出', 'success');
      }
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '日志导出失败';
    } finally {
      if (lifecycle === this.lifecycle) this.exportBusy = false;
    }
  }

  private refreshLog(): void {
    this.moreOpen = false;
    if (!this.session.selectedDate || this.refreshing) return;
    const date = this.session.selectedDate;
    this.confirmDiscard(() => this.refreshCurrentDay(date));
  }

  private async refreshCurrentDay(date: string): Promise<void> {
    if (this.refreshing) return;
    const lifecycle = this.lifecycle;
    const revision = this.documents.dayLoadRevision + 1;
    this.refreshing = true;
    try {
      await this.loadDay(date);
      if (lifecycle !== this.lifecycle || revision !== this.documents.dayLoadRevision || this.session.selectedDate !== date) return;
      appFeedback.show(this.readFailed ? this.errorMessage || '日志刷新失败' : '日志已刷新',
        this.readFailed ? 'error' : 'success');
    } finally {
      if (lifecycle === this.lifecycle) this.refreshing = false;
    }
  }

  private closeSearch(): void {
    this.searchOpen = false;
    this.search.dismissSearchResults();
  }

  private async confirmDelete(): Promise<void> {
    if (!this.session.day?.exists || !this.session.day.version || this.documents.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) return;
    this.moreOpen = false;
    const date = this.session.day.date;
    const version = this.session.day.version;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== date || this.session.day?.version !== version) return;
        this.session.text = snapshot.text;
        this.session.editorPending = false;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    AlertDialog.show({
      message: this.session.isDirty() ? `确认删除 ${date} 日块？当前有未保存修改，删除会保留写入前备份。` :
        `确认删除 ${date} 日块？此操作会保留写入前备份。`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'),
        action: () => { if (this.session.day?.date === date && this.session.day.version === version) this.deleteDay(date, version); } }
    });
  }

  private async acceptDeletedDay(day: DayEntry, date: string): Promise<void> {
    const body = this.bodyFromDay(day);
    if (this.editor.ready && this.editor.documentKey === date) {
      await this.editor.replace(body, true);
    }
    if (date !== this.session.selectedDate) return;
    this.session.commitDocument(day, body);
    this.previewText = body;
    this.reportDraft();
    this.sourceMode = false;
    this.splitMode = false;
    this.reads.invalidate();
    this.refreshNavigation(date);
    appFeedback.show('日块已删除', 'success');
  }

  private async deleteDay(date: string, version: string): Promise<void> {
    if (this.deleting || this.documents.saving || this.backupOpen || this.linkOpen) return;
    const lifecycle = this.lifecycle;
    const revision = this.documents.dayLoadRevision;
    this.deleting = true;
    this.saveError = '';
    try {
      const response = await this.writes.delete({ date, baseVersion: version });
      if (lifecycle !== this.lifecycle || revision !== this.documents.dayLoadRevision || this.session.day?.date !== date) return;
      if (!response.day || !matchesDeletedDay(response.day, date)) throw new Error('删除响应格式异常');
      await this.acceptDeletedDay(response.day, date);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.documents.dayLoadRevision) return;
      const uncertain = !(error instanceof ApiError) || error.statusCode === 0 || error.statusCode === 404 ||
        error.statusCode === 409 || error.statusCode >= 500 || error.code === 'INVALID_RESPONSE';
      if (uncertain) {
        try {
          const current = await this.reads.day(date);
          if (lifecycle !== this.lifecycle || revision !== this.documents.dayLoadRevision || this.session.day?.date !== date) return;
          if (current.day && matchesDeletedDay(current.day, date)) {
            await this.acceptDeletedDay(current.day, date);
            return;
          }
        } catch (_) { if (lifecycle !== this.lifecycle || revision !== this.documents.dayLoadRevision) return; }
      }
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未删除。请刷新后核对。' : error instanceof Error ? error.message : '删除失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.documents.dayLoadRevision) this.deleting = false;
    }
  }

  private async loadMonths(): Promise<void> {
    await this.logNavigation.loadMonths();
  }

  private async loadDays(month: string, targetDate: string = ''): Promise<void> {
    await this.logNavigation.loadDays(month, targetDate);
  }

  private installDay(day: DayEntry, date: string, heading: string, headingIndex: number): void {
    const body = this.bodyFromDay(day);
    const restore = !this.restoredDraftApplied ? restoredLogDraft(this.initialDraft,
      activeInstance.namespace, date, body, day.version) : undefined;
    const nextText = restore ? restore.text : body;
    const changed = this.session.day?.date !== date || this.previewText !== nextText;
    if (this.pendingImageDate && this.pendingImageDate !== date) this.cancelPendingImages();
    this.session.commitDocument(day, body);
    if (changed) {
      this.readerReady = false;
      this.renderedPreviewDate = '';
      this.editorReady = false;
    }
    this.previewRestoreOffset = this.previewScrollOffsets[date] || 0;
    this.previewOffset = this.previewRestoreOffset;
    if (this.initialDraft?.namespace === activeInstance.namespace && this.initialDraft.date === date) {
      this.restoredDraftApplied = true;
    }
    if (restore) {
      this.session.resetEditor(nextText);
      this.session.baseVersion = this.initialDraft!.baseVersion;
    }
    this.previewText = this.session.text;
    this.activeOutlineId = this.outlineHeadings()[Math.max(0, headingIndex)]?.id || '';
    this.reportDraft();
    this.saveError = restore?.conflict ?
      '已恢复本机草稿，但服务器版本已变化。请核对后复制草稿并刷新，保存不会覆盖新版本。' : '';
    this.targetHeading = heading;
    this.targetHeadingIndex = headingIndex;
    this.targetHeadingId = '';
    this.targetKind = '';
    this.targetQuery = '';
    if (heading) this.targetRevision++;
    this.closeNavigation();
    if (!changed) {
      this.workspaceTransition.finish('document');
      if (this.isLogDocumentReady(date)) this.logDocumentReady(date);
    }
  }

  private async loadDay(date: string, heading: string = '', headingIndex: number = -1): Promise<void> {
    await this.documents.loadDay(date, heading, headingIndex);
  }

  private async coverLogDocument(): Promise<void> {
    if (this.workspaceTransition.kind === 'module' || this.workspaceTransition.waitingKind === 'module') return;
    if ((this.workspaceTransition.waitingKind && this.workspaceTransition.waitingKind !== 'document') ||
      (this.workspaceTransition.kind && this.workspaceTransition.kind !== 'document')) {
      this.workspaceTransition.clear();
    }
    await this.workspaceTransition.cover('document');
  }

  private async loadTargetDate(date: string, apply: () => void): Promise<void> {
    const lifecycle = this.lifecycle;
    if (this.session.day?.date !== date) {
      if (date.slice(0, 7) !== this.logNavigation.month) await this.loadDays(date.slice(0, 7), date);
      else await this.loadDay(date);
    }
    if (lifecycle !== this.lifecycle) return;
    if (this.session.day?.date !== date) {
      if (this.readFailed) this.retryRead = async () => this.loadTargetDate(date, apply);
      return;
    }
    apply();
  }

  private async openInternalLink(date: string, heading: string, kind: string = 'internal', query: string = ''): Promise<void> {
    await this.loadTargetDate(date, () => {
      this.targetHeading = heading;
      this.targetHeadingIndex = -1;
      this.targetHeadingId = heading;
      this.targetKind = kind;
      this.targetQuery = query;
      this.targetRevision++;
    });
  }

  private showTargetResult(kind: string, found: boolean): void {
    if (kind === 'outline') {
      appFeedback.show(found ? '已定位到小节' : '未找到大纲小节',
        found ? 'success' : 'warning', 3600, 'navigation');
    } else if (kind === 'internal') {
      appFeedback.show(found ? '已定位到内部链接' : '已打开目标日块，但未找到标题',
        found ? 'success' : 'warning', 3600, 'navigation');
    } else if (kind === 'search') {
      appFeedback.show(found ? '已定位到搜索关键词' : '已打开日块，但未在预览中定位到关键词',
        found ? 'success' : 'warning', 3600, 'navigation');
    } else if (kind === 'favorite') {
      appFeedback.show(found ? '已定位到收藏小节' : '已打开收藏日块，但未找到标题',
        found ? 'success' : 'warning');
    } else if (kind === 'citation') {
      appFeedback.show(found ? '已定位到引用小节' : '已打开来源日块，但未找到引用小节',
        found ? 'success' : 'warning');
    } else if (kind === 'stats') {
      appFeedback.show(found ? '已定位到统计小节' : '已打开日块，但未找到统计小节',
        found ? 'success' : 'warning');
    }
  }

  private calendarDate(value: Date): string {
    return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
  }

  private openCalendar(mode: string): void {
    this.calendarMode = mode;
    if (!this.newLogDate) this.newLogDate = this.calendarDate(new Date());
    this.logNavigation.calendarMonth = (mode === 'jump' ? this.session.selectedDate || this.newLogDate : this.newLogDate).slice(0, 7);
    this.calendarOpen = true;
    this.loadCalendar();
  }

  private async loadCalendar(): Promise<void> {
    await this.logNavigation.loadCalendar();
  }

  private async openDate(date: string, edit: boolean): Promise<void> {
    if (date.slice(0, 7) === this.logNavigation.month) await this.loadDay(date);
    else await this.loadDays(date.slice(0, 7), date);
    if (edit && this.session.day?.date === date) { this.sourceMode = true; this.splitMode = false; }
  }

  private openNewLog(date: string): void {
    this.calendarOpen = false;
    this.confirmDiscard(() => this.openDate(date, true));
  }

  private openHeading(day: DaySummary, heading: string, index: number): void {
    if (this.session.day?.date === day.date) {
      this.targetHeading = heading;
      this.targetHeadingIndex = index;
      this.targetHeadingId = '';
      this.targetKind = '';
      this.targetQuery = '';
      this.targetRevision++;
      this.closeNavigation();
    } else this.confirmDiscard(() => this.loadDay(day.date, heading, index));
  }

  private adjacentDay(offset: number): string {
    const index = this.logNavigation.days.findIndex((item: DaySummary) => item.date === this.session.selectedDate);
    if (index < 0) return '';
    return this.logNavigation.days[index + offset]?.date || '';
  }

  private navigateDay(offset: number): void {
    const date = this.adjacentDay(offset);
    if (date) this.confirmDiscard(() => this.loadDay(date));
  }

  @Builder
  private desktopAdjacentButton(label: string, direction: number) {
    Button({ type: ButtonType.Normal }) {
      if (this.reading.logsReadingMode || this.showToolbarLabels('navigation')) {
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
      .width(this.reading.logsReadingMode || this.showToolbarLabels('navigation') ? undefined : 32)
      .height(this.reading.logsReadingMode ? 34 : 32)
      .padding({ left: this.reading.logsReadingMode ? 10 : this.showToolbarLabels('navigation') ? 12 : 0,
        right: this.reading.logsReadingMode ? 10 : this.showToolbarLabels('navigation') ? 12 : 0 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(7)
      .accessibilityText(label).enabled(this.adjacentDay(direction).length > 0)
      .onClick(() => this.navigateDay(direction))
  }

  private setDesktopNavigationCollapsed(collapsed: boolean, section: number = -1): void {
    this.navigationCommands.sidebarCollapsed(collapsed, section);
  }

  private desktopNavigationWidth(): number {
    const full = this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220;
    return 52 + (full - 52) * (this.sidebar.sidebarAnimating ? this.sidebar.sidebarExpansion :
      (this.isDesktopNavigationCollapsed() ? 0 : 1));
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
        this.desktopMoreItem($r('app.media.refresh_cw'), '刷新', !!this.session.selectedDate && !this.refreshing &&
          !this.documents.saving && !this.deleting,
          () => this.refreshLog())
      }
      this.desktopMoreItem($r('app.media.layout_list'), '大纲', this.outlineHeadings().length > 0,
        () => this.pendingOutlineOpen = true)
      this.desktopMoreItem($r('app.media.panel_right_open'), 'AI 工具', !!this.session.day,
        () => this.openAiTools())
      if (!this.editorActionsInHeader()) {
        this.desktopMoreItem($r('app.media.upload'), '插入图片', !!this.session.day && !this.imageBusy,
          () => this.insertImages())
        this.desktopMoreItem($r('app.media.eye'), '放弃修改', this.editorReady && this.session.isDirty(),
          () => this.discardDraft())
      }
      if (!this.documentActionsInHeader('backup')) {
        this.desktopMoreItem($r('app.media.database_backup'), '备份', !!this.session.day && !this.documents.saving,
          () => this.backupOpen = true)
      }
      if (!this.documentActionsInHeader('delete')) {
        this.desktopMoreItem($r('app.media.trash_2'), '删除日块', !!this.session.day?.exists && !this.deleting,
          () => this.confirmDelete())
      }
      if (!this.documentActionsInHeader('export')) {
        Divider().color($r('app.color.hairline')).margin({ top: 4, bottom: 4 })
        this.desktopMoreItem($r('app.media.download'), '导出当前日块', !!this.session.day && !this.exportBusy,
          () => this.exportLogs('day'))
        this.desktopMoreItem($r('app.media.download'), '导出当前源文件', !!this.session.day && !this.exportBusy,
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
    if (!this.session.day || !this.session.isDirty() || !this.editorReady) return;
    try {
      await this.editor.replace(this.session.baseline, true);
      this.session.text = this.session.baseline;
      this.previewText = this.session.baseline;
      this.session.editorPending = false;
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
      .enabled(!this.exportBusy && (scope === 'all' || !!this.session.selectedDate))
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
        this.moreAction($r('app.media.refresh_cw'), '刷新', !!this.session.selectedDate && !this.refreshing &&
          !this.documents.saving && !this.deleting,
          () => this.refreshLog())
        this.moreAction($r('app.media.layout_list'), '大纲', this.outlineHeadings().length > 0,
          () => this.pendingOutlineOpen = true)
        this.moreAction($r('app.media.panel_right_open'), 'AI 工具', !!this.session.day,
          () => this.openAiTools())
      }.width('100%')
      Row({ space: 8 }) {
        this.moreAction($r('app.media.upload'), '插入图片', !!this.session.day && !this.imageBusy,
          () => this.insertImages())
        this.moreAction($r('app.media.eye'), '放弃修改', this.editorReady && this.session.isDirty(),
          () => this.discardDraft())
        this.moreAction($r('app.media.database_backup'), '备份', !!this.session.day && !this.documents.saving,
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
        .borderRadius(8).clip(true).enabled(!!this.session.day?.exists && !this.deleting)
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
  private exportMenuItem(label: string, scope: string) {
    Button({ type: ButtonType.Normal, stateEffect: false }) {
      Text(label).fontSize(13).fontColor($r('app.color.body'))
        .width('100%').textAlign(TextAlign.Start)
    }
    .width('100%').height(42).padding({ left: 12, right: 12 }).borderRadius(6)
    .attributeModifier(new InteractiveSurface(Color.Transparent, this.hoveredExport === scope))
    .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredExport = hover ? scope : ''))
    .enabled(!this.exportBusy && (scope === 'all' || this.session.selectedDate.length > 0))
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
          showLabel: true, busy: this.imageBusy, available: !!this.session.day && this.editorReady,
          onAction: () => this.insertImages() })
        ToolbarAction({ label: '放弃修改', icon: $r('app.media.eye'), iconSize: 15,
          showLabel: true, available: this.editorReady && this.session.isDirty(),
          onAction: () => this.discardDraft() })
        ToolbarAction({ label: '查找替换', icon: $r('app.media.search'), iconSize: 15,
          showLabel: true, available: this.editorReady,
          onAction: () => this.editor.command('find') })
      }
      LogDisplayModeControl({ sourceMode: this.sourceMode, splitMode: this.splitMode,
        expanded: this.expandedModeSelector(), showLabels: this.showToolbarLabels('mode'),
        onMode: (mode: string) => this.switchMode(mode === 'source', mode === 'split') })
      Column() {
        ToolbarAction({ label: this.refreshing ? '刷新中' : '刷新', reservedLabel: '刷新中',
          icon: $r('app.media.refresh_cw'), iconSize: 15, busy: this.refreshing,
          showLabel: this.showToolbarLabels('refresh'),
          available: !!this.session.selectedDate && !this.refreshing && !this.documents.saving && !this.deleting && !this.imageBusy,
          onAction: () => this.refreshLog() })
      }.width(this.desktopActionSlotWidth('refresh', '刷新中')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('refresh', '刷新中') - 1) })
        .opacity(this.desktopActionSlotPresence('refresh', '刷新中'))
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
          available: !!this.session.day && !this.documents.saving && !this.deleting,
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
          available: !!this.session.day?.exists && !this.documents.saving,
          onAction: () => this.confirmDelete() })
      }.width(this.desktopActionSlotWidth('delete', '删除')).clip(true)
        .margin({ left: (this.headerWidth < 440 ? 4 : 8) *
          (this.desktopActionSlotPresence('delete', '删除') - 1) })
        .opacity(this.desktopActionSlotPresence('delete', '删除'))
        .hitTestBehavior(this.documentActionsInHeader('delete') ? HitTestMode.Default : HitTestMode.None)
        .accessibilityLevel(this.documentActionsInHeader('delete') ? 'auto' : 'no-hide-descendants')
      ToolbarAction({ label: this.documents.saving ? '保存中' : '保存', reservedLabel: '保存中',
        icon: $r('app.media.save'), iconSize: 15,
        showLabel: this.showToolbarLabels('save'), primary: true, busy: this.documents.saving,
        available: this.editorReady && this.session.isDirty(), disabledReason: '没有未保存的修改',
        onAction: () => this.save() })
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

  private closeBackup(): void {
    if (this.backupBusy) return;
    this.backupOpen = false;
    this.backupMaximized = false;
  }

  @Builder
  private backupSheet() {
    BackupPanel({ date: this.session.day?.date || '', maximized: $backupMaximized, themePreference: this.themePreference,
      onClose: () => this.closeBackup(),
      onBeforeRestore: () => this.beforeRestore(),
      onRestored: (day: DayEntry) => this.applyRestoredDay(day),
      onBusyChange: (busy: boolean) => this.backupBusy = busy })
  }

  @Builder
  private backupDialog() {
    AppModalFrame({ content: (): void => this.backupDialogContent() })
  }

  @Builder
  private backupDialogContent() {
    Stack({ alignContent: Alignment.Center }) {
      AppModalScrim({ onDismiss: () => this.closeBackup() })
      Column() { this.backupSheet() }
        .width(this.backupMaximized ? '100%' : '92%')
        .constraintSize({ maxWidth: this.backupMaximized ? '100%' : 1120 })
        .height(this.backupMaximized ? '100%' : '85%')
        .border({ width: this.backupMaximized ? 0 : 1, color: $r('app.color.hairline') })
        .borderRadius(this.backupMaximized ? 0 : 12).clip(true)
        .id('backup_dialog_surface')
    }.width('100%').height('100%').id('backup_dialog_viewport')
  }

  @Builder
  private heading() {
    if (this.isWide()) {
      Stack({ alignContent: Alignment.Top }) {
        Column() {
          DesktopLogHeader({ fileName: this.session.day?.fileName || '', selectedDate: this.session.selectedDate,
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
            .bindContentCover($$this.backupOpen, this.backupDialog(), {
              transition: floatingSurfaceTransition(), backgroundColor: Color.Transparent, enableSafeArea: true,
              onWillDismiss: (action: DismissContentCoverAction) => { if (!this.backupBusy) action.dismiss(); }
            })
        }.width('100%').height(64)
          .opacity(Math.max(0, 1 - 2 * this.reading.readingProgress))
          .visibility(this.reading.readingProgress < 1 ? Visibility.Visible : Visibility.Hidden)
          .zIndex(this.reading.logsReadingMode ? 0 : 1)
          .hitTestBehavior(this.reading.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
          .accessibilityLevel(this.reading.logsReadingMode ? 'no-hide-descendants' : 'auto')
        Column() {
          ReadingLogHeader({ selectedDate: this.session.selectedDate, workspaceBreakpoint: this.workspaceBreakpoint,
            hasOutline: this.outlineHeadings().length > 0,
            previousButton: (): void => this.desktopAdjacentButton('上一篇', 1),
            nextButton: (): void => this.desktopAdjacentButton('下一篇', -1),
            onOutline: () => this.readingOutlineOpen = true,
            onExit: () => this.setLogsReadingMode(false) })
        }.width('100%').height(64)
          .opacity(Math.max(0, 2 * this.reading.readingProgress - 1))
          .visibility(this.reading.readingProgress > 0 ? Visibility.Visible : Visibility.Hidden)
          .zIndex(this.reading.logsReadingMode ? 1 : 0)
          .hitTestBehavior(this.reading.logsReadingMode ? HitTestMode.Default : HitTestMode.None)
          .accessibilityLevel(this.reading.logsReadingMode ? 'auto' : 'no-hide-descendants')
      }.width('100%').height(64).clip(true).id('log_reader_header')
    } else {
      CompactLogHeader({ selectedDate: this.session.selectedDate, workspaceBreakpoint: this.workspaceBreakpoint,
        desktopWindowChrome: this.desktopWindowChrome,
        backupRestoring: this.backupBusy, backupOpen: $backupOpen, backupSheet: (): void => this.backupSheet(),
        sourceMode: this.sourceMode, saving: this.documents.saving, dirty: this.editorReady && this.session.isDirty(),
        moreOpen: $moreOpen, moreActionsPanel: (): void => this.compactMoreActionsPanel(),
        onActionsDisappear: () => this.handleActionsDisappear(),
        onMode: (mode: string) => this.switchMode(mode === 'source'),
        onSave: () => this.save() })
    }
  }

  @Builder
  private desktopOutline(feedbackEnabled: boolean) {
    Column() {
      Column({ space: 10 }) {
        Text('目录').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
          .width('100%').padding({ left: 8 })
        List({ space: 2, scroller: this.desktopOutlineScroller }) {
          ForEach(this.outlineHeadings(), (heading: LogOutlineHeading) => {
            ListItem() {
              Row({ space: 2 }) {
                Button({ type: ButtonType.Normal, stateEffect: false }) {
                  Text(heading.text).width('100%').maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Start)
                    .fontSize(12)
                    .fontWeight(this.activeOutlineId === heading.id ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.activeOutlineId === heading.id ? $r('app.color.ink') : $r('app.color.muted'))
                }
                .layoutWeight(1).constraintSize({ minHeight: 30 }).padding({ left: 8, right: 4, top: 4, bottom: 4 })
                .backgroundColor(Color.Transparent).borderRadius(6).onClick(() => this.locateOutlineHeading(heading))
                if (heading.level === 3) {
                  Button({ type: ButtonType.Normal }) {
                    if (this.outlineFavorite(heading)) {
                      SymbolGlyph($r('sys.symbol.star_fill')).fontSize(14).fontColor([$r('app.color.ink')])
                    } else {
                      SymbolGlyph($r('sys.symbol.star')).fontSize(14).fontColor([$r('app.color.muted_soft')])
                    }
                  }.width(28).height(28).padding(0).backgroundColor(Color.Transparent).borderRadius(6)
                    .id(`log_outline_favorite_${heading.id}`)
                    .enabled(!this.favoriteBusy)
                    .accessibilityText(this.outlineFavorite(heading) ? '取消收藏' : '收藏小节').bindTips(this.outlineFavorite(heading) ? '取消收藏' : '收藏小节', WORKSPACE_TIPS)
                    .onClick(() => this.toggleOutlineFavorite(heading))
                    .bindPopup(feedbackEnabled && this.favoriteFeedbackVisible(heading), {
                      builder: () => { this.favoriteFeedbackPopup(heading) },
                      placement: Placement.Left,
                      popupColor: $r('app.color.canvas'),
                      enableArrow: false,
                      autoCancel: true,
                      targetSpace: 8,
                      width: 236,
                      radius: 10,
                      backgroundBlurStyle: BlurStyle.NONE,
                      shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
                      onStateChange: (event) => {
                        if (!event.isVisible && this.favoriteFeedbackVisible(heading)) this.closeFavoriteFeedback();
                      }
                    })
                }
              }.width('100%').padding({ right: 3 })
                .backgroundColor(this.activeOutlineId === heading.id ? $r('app.color.surface_soft') : Color.Transparent)
                .border({ width: { left: this.activeOutlineId === heading.id ? 2 : 0 }, color: $r('app.color.primary') })
                .borderRadius(6)
            }
          }, (heading: LogOutlineHeading) => heading.id)
        }.layoutWeight(1).width('100%')
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
      }.layoutWeight(1).width('100%').padding({ left: 8, right: 8, top: 28, bottom: 18 })
        .border({ width: { left: this.reading.logsReadingMode ? 0 : 1 }, color: $r('app.color.hairline_soft') })
    }
    .width('100%').height('100%').backgroundColor($r('app.color.canvas'))
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
    if (!this.session.day || this.ai.busy) return;
    try {
      const date = this.session.day.date;
      let body = this.session.text;
      if (this.editorReady) {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== date || this.session.day?.date !== date) return;
        body = snapshot.text;
      } else if (this.sourceMode || this.splitMode) {
        this.ai.message = '编辑器尚未就绪，请稍后重试';
        return;
      }
      this.session.text = body;
      this.session.editorPending = false;
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
          Text(`${this.session.selectedDate} · ${this.outlineHeadings().length} 个标题`)
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
        ForEach(this.outlineHeadings(), (heading: LogOutlineHeading) => {
          ListItem() {
            Row() {
              Button({ type: ButtonType.Normal }) {
                Text(heading.text)
                  .fontSize(heading.level <= 2 ? 15 : (heading.level === 3 ? 14 : 13))
                  .fontWeight(heading.level <= 2 ? FontWeight.Medium : FontWeight.Regular)
                  .fontColor(this.activeOutlineId === heading.id ? $r('app.color.ink') :
                    (heading.level <= 3 ? $r('app.color.body') : $r('app.color.muted')))
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%').textAlign(TextAlign.Start)
              }.layoutWeight(1).constraintSize({ minHeight: 44 })
                .padding({ left: 10 + Math.max(0, heading.level - 2) * 12, right: 4, top: 7, bottom: 7 })
                .backgroundColor(Color.Transparent).borderRadius(8)
                .onClick(() => {
                  this.locateOutlineHeading(heading);
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
              .backgroundColor(this.activeOutlineId === heading.id ? $r('app.color.primary_tint') :
                $r('app.color.surface_card'))
              .border({ width: 1, color: this.activeOutlineId === heading.id ?
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

  private async prepareEditor(date: string, lifecycle: number): Promise<boolean> {
    if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
    if (lifecycle !== this.lifecycle || this.session.day?.date !== date) return false;
    for (let attempt = 0; attempt < 50 && this.editor.loadedDocumentKey !== date; attempt += 1) {
      if (lifecycle !== this.lifecycle || this.session.day?.date !== date) return false;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    if (!this.editorReady || this.editor.loadedDocumentKey !== date) {
      throw new Error('编辑器尚未就绪，请稍后重试');
    }
    return true;
  }

  private async findInEditor(): Promise<void> {
    if (!this.session.day) return;
    const date = this.session.day.date;
    const lifecycle = this.lifecycle;
    try {
      if (!await this.prepareEditor(date, lifecycle)) return;
      await this.editor.command('find');
    }
    catch (error) { this.saveError = error instanceof Error ? error.message : '无法打开查找'; }
  }

  private async applyAiOutput(): Promise<void> {
    if (!this.session.day || !this.ai.output.trim() || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const date = this.session.day.date;
    const revision = this.ai.requestRevision;
    const output = this.ai.output;
    const current = (): boolean => lifecycle === this.lifecycle && this.session.day?.date === date &&
      revision === this.ai.requestRevision && this.ai.outputDate === date && this.ai.output === output && !this.ai.busy;
    if (this.ai.outputDate !== date) { this.ai.message = '请切回生成草稿时的日块'; return; }
    try {
      if (!await this.prepareEditor(date, lifecycle)) return;
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
    if (!this.session.day || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const date = this.session.day.date;
    const revision = this.ai.requestRevision;
    const highlighted = this.ai.highlighted;
    const originalDraft = this.ai.originalDraft;
    const current = (): boolean => lifecycle === this.lifecycle && this.session.day?.date === date &&
      revision === this.ai.requestRevision && this.ai.highlightDate === date &&
      this.ai.highlighted === highlighted && this.ai.originalDraft === originalDraft && !this.ai.busy;
    try {
      if (!await this.prepareEditor(date, lifecycle)) return;
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
    if (this.sidebar.sidebarAnimating) return;
    this.aiMode = mode;
    if (this.aiOpen && !this.aiClosing) return;
    this.aiClosing = false;
    this.aiOpen = true;
    this.moveAiTools(0);
  }

  private closeAiTools(): void {
    if (this.sidebar.sidebarAnimating) return;
    if (!this.aiOpen || this.aiClosing) return;
    this.aiClosing = true;
    this.moveAiTools(420);
  }

  private beginToolbarMotion(width: number): number[][] {
    const actions = ['refresh', 'export', 'backup', 'delete'];
    const labels = ['刷新中', '导出', '备份', '删除'];
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
            if (revision !== this.aiMotionRevision || this.sidebar.sidebarAnimating) return;
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
      busy: this.ai.busy, importing: this.ai.importing, ready: !!this.session.day,
      generateConfigured: !!activeInstance.capabilities?.features.aiWriting.configured,
      highlightConfigured: !!activeInstance.capabilities?.features.aiHighlighting.configured,
      canHighlight: !!this.session.text.trim(),
      canApply: !!this.ai.output.trim() && this.ai.outputDate === this.session.selectedDate,
      message: this.ai.message || (this.aiMode === 'generate' &&
        !activeInstance.capabilities?.features.aiWriting.configured || this.aiMode === 'highlight' &&
        !activeInstance.capabilities?.features.aiHighlighting.configured ?
        '当前实例尚未配置对应模型能力' : ''),
      desktop: this.isWide(), onClose: () => this.closeAiTools(),
      onImport: () => this.importAiMaterial(),
      onGenerate: () => this.ai.generate(this.session.selectedDate),
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
      if (this.logNavigation.monthsLoading || !this.session.day && (this.logNavigation.daysLoading || this.documents.dayRequestLoading)) {
        Column() {
          LoadingProgress().width(26).height(26).color($r('app.color.primary'))
        }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      } else if (this.errorMessage && !this.session.day) {
        LoadFailure({ message: this.errorMessage,
          onRetry: () => this.retryRead() })
      } else if (this.session.day) {
        this.heading()
        Stack({ alignContent: Alignment.TopEnd }) {
          Row() {
            Column() {
              if (this.pendingImageCount > 0) {
                Row({ space: 8 }) {
                  Text(`已接收 ${this.pendingImageCount} 张图片，请在正文中选择插入位置`)
                    .fontSize(13).fontColor($r('app.color.muted')).layoutWeight(1)
                    .textAlign(TextAlign.Start).id('pending_images_hint')
                  ToolbarAction({ label: '插入图片', icon: $r('app.media.upload'),
                    available: !this.imageBusy && this.editorReady,
                    onAction: () => this.insertPendingImages() }).id('pending_images_insert')
                  ToolbarAction({ label: '取消', icon: $r('app.media.x'),
                    available: !this.imageBusy,
                    onAction: () => this.cancelPendingImages() }).id('pending_images_cancel')
                }.width('100%').padding({ top: 8, bottom: 8, left: 16, right: 16 })
                  .backgroundColor($r('app.color.canvas'))
              }
              SourceEditor({ session: this.editor, documentKey: this.session.day.date,
                initialText: this.session.editorInitialText })
                .width('100%').layoutWeight(1)
                .bindSheet($$this.linkOpen, this.editorLinkPanel(), {
                  preferType: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
                  width: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : 780,
                  height: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetSize.LARGE : 620,
                  dragBar: false, showClose: false, backgroundColor: Color.Transparent,
                  keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY,
                  maskColor: $r('app.color.scrim'),
                  radius: { topLeft: 12, topRight: 12,
                    bottomLeft: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12,
                    bottomRight: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12 },
                  onDisappear: () => this.finishLink()
                })
            }
              .width(this.isWide() && this.splitMode ? '50%' : (this.sourceMode || this.splitMode ? '100%' : 0))
              .height('100%')
              .visibility(this.sourceMode || this.splitMode ? Visibility.Visible : Visibility.None)
              .border({ width: { right: this.isWide() && this.splitMode ? 1 : 0 },
                color: $r('app.color.hairline') })
            Row() {
              Stack({ alignContent: Alignment.TopEnd }) {
              MarkdownReader({ content: this.previewText, contentMode: 'log', documentKey: this.session.day.date,
                onWorkspaceKey: (event: KeyEvent) => this.onWorkspaceKey(event),
                onImageDrop: (event: DragEvent) => this.receivePreviewImages(event),
                themePreference: this.themePreference,
                stableViewport: this.isWide(), fillAvailableWidth: this.splitMode,
                viewportRequestRevision: this.modeLayoutRevision + this.reading.workspaceLayoutRevision,
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
                  this.navigationCommands.readingReady();
                },
                onContentRendered: (_content: string, date: string) => {
                  if (date !== this.session.selectedDate) return;
                  this.renderedPreviewDate = date;
                  this.workspaceTransition.finish('document');
                  if (!(this.sourceMode || this.splitMode && !this.isWide())) this.logDocumentReady(date);
                },
                onRenderReady: () => {
                  this.readerReady = true;
                  this.workspaceTransition.finish('document');
                },
                onRenderFailed: (date: string) => {
                  if (date !== this.session.selectedDate) return;
                  this.readFailed = true;
                  this.retryRead = async () => this.loadDay(date);
                  this.errorMessage = '日志正文渲染失败，请刷新重试';
                  this.showReadFailure();
                  this.workspaceTransition.finish('document');
                  if (!(this.sourceMode || this.splitMode && !this.isWide())) this.logNavigationFailed(date);
                },
                targetHeading: this.targetHeading, targetHeadingIndex: this.targetHeadingIndex,
                outlineRequestRevision: this.outlineRequestRevision,
                targetHeadingId: this.targetHeadingId,
                targetKind: this.targetKind, targetQuery: this.targetQuery, targetRevision: this.targetRevision,
                onTargetResult: (kind: string, found: boolean) => this.showTargetResult(kind, found),
                trackActiveHeading: true,
                onActiveHeading: (headingId: string) => this.updateActiveOutline(headingId),
                onInternalLink: (date: string, heading: string) => {
                  const targetDate = date || this.session.selectedDate;
                  if (!targetDate) return;
                  if (targetDate === this.session.selectedDate) this.openInternalLink(targetDate, heading);
                  else this.confirmDiscard(() => this.openInternalLink(targetDate, heading));
                } })
                .width('100%').height('100%').id('log_reading_surface')
                .onAreaChange((_oldArea: Area, area: Area) => this.readingViewportChanged(area))
              if (!this.previewText.trim() && this.readerReady) {
                Column({ space: 8 }) {
                  SymbolGlyph($r('sys.symbol.doc_text')).fontSize(20).fontColor([$r('app.color.muted_soft')])
                  Text('暂无正文').fontSize(13).fontColor($r('app.color.muted'))
                }.width('100%').height('100%').justifyContent(FlexAlign.Center)
                  .backgroundColor($r('app.color.canvas')).hitTestBehavior(HitTestMode.None)
              }
              if (!this.readerReady && !this.renderedPreviewDate && !this.sourceMode) {
                Column() {
                  LoadingProgress().width(26).height(26).color($r('app.color.primary'))
                }.width('100%').height('100%').justifyContent(FlexAlign.Center)
                  .backgroundColor($r('app.color.canvas')).zIndex(2)
                  .hitTestBehavior(HitTestMode.None)
              }
              if (this.isWide() && !this.reading.logsReadingMode && !this.sourceMode && !this.splitMode &&
                this.readerReady && this.renderedPreviewDate === this.session.selectedDate) {
                Column() { this.readingModeEntryButton() }
                  .width(36).height(36).margin({ top: 16, right: 16 }).zIndex(3)
              }
              }.layoutWeight(1).height('100%')
              if (this.showDesktopOutline()) {
                Column() { this.desktopOutline(true) }.width(224).height('100%')
              }
            }.width(this.isWide() && this.splitMode ? '50%' :
              (this.sourceMode || this.splitMode && !this.isWide() ? 0 : '100%'))
              .height('100%').visibility(this.sourceMode || this.splitMode && !this.isWide() ?
                Visibility.None : Visibility.Visible)
          }.width('100%').height('100%')
          LoadingHintAnchor({ loading: !this.readFailed && (this.documents.dayRequestLoading || this.logNavigation.daysLoading ||
            !this.sourceMode && this.renderedPreviewDate.length > 0 && !this.readerReady),
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

  @Builder
  private logContent() {
      Row() {
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
            if (this.aiOpen && this.aiOffset === 0 && !this.reading.logsReadingMode) this.aiResizer()
          }.width((52 + (this.aiPanelWidth - 52) * (1 - this.aiOffset / 420)) *
              (1 - this.reading.readingProgress))
            .height('100%')
            .backgroundColor(this.aiOpen ? $r('app.color.canvas') : $r('app.color.surface_soft'))
            .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
            .border({ width: { left: 1 }, color: $r('app.color.hairline') })
            .hitTestBehavior(this.reading.logsReadingMode ? HitTestMode.None : HitTestMode.Default)
            .clip(true).id('log_ai_dock')
        }
      }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
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
  }

  @Builder
  private readingOutlineOverlay() {
      if (this.readingOutlineOpen && this.reading.logsReadingMode && this.isWide()) {
        Stack({ alignContent: Alignment.TopEnd }) {
          Column().width('100%').height('100%').onClick(() => this.readingOutlineOpen = false)
          Column() { this.desktopOutline(true) }
            .width(320).height(Math.min(560, 76 + this.outlineHeadings().length * 34))
            .margin({ top: 80, right: 16 })
            .backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') })
            .borderRadius(8).clip(true)
            .shadow({ radius: 18, color: $r('app.color.popover_shadow'), offsetY: 6 })
        }.width('100%').height('100%').zIndex(6)
          .transition(floatingSurfaceTransition())
      }
  }

  @Builder
  private editorLinkPanel() {
    EditorLinkPicker({ initialAlias: this.linkAlias, onClose: () => this.closeLink(),
      onInsert: (markup: string) => this.insertLink(markup) })
  }

  @Builder
  private favoriteGroupDialog() {
    LogFavoriteGroupPanel({ data: this.favoritesData, favoriteId: this.favoriteGroupDialogId,
      wide: this.isWide(), onClose: () => this.favoriteGroupDialogOpen = false,
      onOpenFavorites: () => { this.favoriteGroupDialogOpen = false; this.closeOutline(); this.selectTab(2); },
      onRemove: (favorite: FavoriteHeading) => this.removeOutlineFavorite(favorite) })
      .width('100%').height('100%')
  }

  @Builder
  private highlightOverlay() {
      if (this.ai.reviewOpen) {
        LogHighlightReview({ original: this.ai.originalDraft, highlighted: this.ai.highlighted,
          themePreference: this.themePreference,
          date: this.ai.highlightDate,
          available: this.ai.highlightDate === this.session.selectedDate && this.ai.originalDraft === this.session.text,
          onClose: () => this.ai.reviewOpen = false, onApply: () => this.applyAiHighlight() })
          .width('100%').height('100%').transition(floatingSurfaceTransition())
      }
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      this.logContent()
      this.readingOutlineOverlay()
      this.highlightOverlay()
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      .bindContentCover($$this.favoriteGroupDialogOpen, this.favoriteGroupDialog(), {
        transition: floatingSurfaceTransition(), backgroundColor: Color.Transparent, enableSafeArea: true
      })
      .parallelGesture(PanGesture({ direction: PanDirection.All, distance: 6 })
        .onActionStart((event: GestureEvent) => this.handleOutlinePanStart(event))
        .onActionEnd((event: GestureEvent) => this.handleOutlinePanEnd(event))
        .onActionCancel(() => this.outlineGestureActive = false))
  }
}

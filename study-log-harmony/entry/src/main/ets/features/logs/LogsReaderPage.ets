import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { apiClient, ApiError, ApiUploadFile } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { EmptyState, LoadFailure } from '../../common/ui/FeedbackStates';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { AppLogo } from '../../common/ui/AppLogo';
import { SourceEditor, SourceEditorSession, EditorSnapshot, EditorImageData } from '../../common/editor/SourceEditor';
import { common } from '@kit.AbilityKit';
import { saveExport } from '../../common/files/DocumentExport';
import { EditorLinkPicker } from '../../common/editor/EditorLinkPicker';
import { DayEntry, DaySummary, MonthSummary } from './LogModels';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';
import { LogNavigation } from './components/LogNavigation';
import { DesktopLogHeader } from './components/DesktopLogHeader';
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
import { DesktopLogCommands, DesktopMenuEntry } from '../../app/DesktopMenu';
import { iconTint } from '../../common/ui/IconTint';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { ToolbarDensity, resolveToolbarDensity, toolbarActionWidth, toolbarActionsWidth } from '../../common/ui/ToolbarLayout';
import { StatsPage } from '../stats/StatsPage';
import { StatsEntry } from '../stats/StatsModels';
import { StatsNavigation } from '../stats/components/StatsNavigation';
import { FavoritesController } from '../favorites/FavoritesController';
import { FavoritesPage } from '../favorites/FavoritesPage';
import { FavoritesNavigation } from '../favorites/components/FavoritesNavigation';
import { FavoriteHeading } from '../favorites/FavoriteModels';
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

export { PreservedLogDraft } from './LogDraftPolicy';

interface LogOutlineHeading { id: string; text: string; level: number; }
interface AddFavoriteResponse { favorite: FavoriteHeading; }
interface AddFavoriteRequest { date: string; headingText: string; headingId: string; level: number; }

@Component
export struct LogsReaderPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @StorageProp('softwareKeyboardVisible') private softwareKeyboardVisible: boolean = false;
  onChangeServer: () => void = () => {};
  onOpenSettings: () => void = () => {};
  onOpenAbout: () => void = () => {};
  onOpenHelp: () => void = () => {};
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
  @State private errorMessage: string = '';
  @State private navigationError: string = '';
  @State private navigationOpen: boolean = false;
  @State private statsOpen: boolean = false;
  @State private favoritesOpen: boolean = false;
  @State private notesOpen: boolean = false;
  @State private qaOpen: boolean = false;
  @State private qaBusy: boolean = false;
  @State private qaDirty: boolean = false;
  @State private qaPending: boolean = false;
  @State private qaSessionId: string = '';
  @State private qaRequestRevision: number = 0;
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
  @State private favoritesData: FavoritesController = new FavoritesController(apiClient);
  @State private favoriteBusy: boolean = false;
  @StorageProp('pref_favoritesView') private favoritesViewMode: string = 'list';
  @State private statsMonths: MonthSummary[] = [];
  @State private statsMonth: string = '';
  @State private statsMonthsLoading: boolean = false;
  @State private statsMonthsError: string = '';
  @State private statsMonthRevision: number = 0;
  @State private statsRefreshRevision: number = 0;
  @State private desktopNavigationCollapsed: boolean = false;
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
  private toolbarMotionWidth: number = -1;
  @State private toolbarActionWidths: number[] = [];
  @State private sourceMode: boolean = false;
  @State private splitMode: boolean = false;
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
  @State private backupBusy: boolean = false;
  @State private linkOpen: boolean = false;
  @State private linkOpening: boolean = false;
  @State private imageBusy: boolean = false;
  @State private exportBusy: boolean = false;
  @State private exportMenuOpen: boolean = false;
  @State private searchOpen: boolean = false;
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
  private logNavigationScroller: Scroller = new Scroller();

  aboutToAppear(): void {
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
      else if (id === 'preview') this.switchMode(false);
      else if (id === 'source') this.switchMode(true);
      else if (id === 'split') this.switchMode(false, true);
    };
    this.onRegisterDesktopCommands(commands);
    this.onCaptureDraft(() => this.captureDraft());
    this.editor.onReadyChange = (ready: boolean) => this.editorReady = ready;
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
    this.editor.onFailure = (message: string) => this.saveError = message;
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

  private selectTab(index: number): void {
    if (index === this.selectedTab()) return;
    if (index === 1) this.openNotes();
    else if (index === 2) this.openFavorites();
    else if (index === 3) this.openQa();
    else if (index === 4) this.openStats();
    else if (this.notesOpen) this.confirmNotesLeave(() => {});
    else if (this.qaOpen) this.confirmQaLeave(() => {});
    else { this.favoritesOpen = false; this.statsOpen = false; }
  }

  private openStats(): void {
    if (this.notesOpen) { this.confirmNotesLeave(() => this.openStats()); return; }
    if (this.qaOpen) { this.confirmQaLeave(() => this.openStats()); return; }
    this.confirmDiscard(() => {
      this.draftText = this.savedText;
      this.editorInitialText = this.savedText;
      this.previewText = this.savedText;
      this.statsOpen = true;
      this.favoritesOpen = false;
      this.notesOpen = false;
      this.qaOpen = false;
      this.navigationOpen = false;
      this.closeSearch();
    });
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

  private openFavorites(): void {
    if (this.notesOpen) { this.confirmNotesLeave(() => this.openFavorites()); return; }
    if (this.qaOpen) { this.confirmQaLeave(() => this.openFavorites()); return; }
    this.confirmDiscard(() => {
      this.draftText = this.savedText;
      this.editorInitialText = this.savedText;
      this.previewText = this.savedText;
      this.favoritesOpen = true;
      this.statsOpen = false;
      this.notesOpen = false;
      this.qaOpen = false;
      this.navigationOpen = false;
      this.closeSearch();
    });
  }

  private openNotes(): void {
    if (this.qaOpen) { this.confirmQaLeave(() => this.openNotes()); return; }
    this.confirmDiscard(() => {
      this.draftText = this.savedText;
      this.editorInitialText = this.savedText;
      this.previewText = this.savedText;
      this.notesOpen = true;
      this.statsOpen = false;
      this.favoritesOpen = false;
      this.qaOpen = false;
      this.navigationOpen = false;
      this.closeSearch();
    });
  }

  private confirmNotesLeave(action: () => void): void {
    if (this.notesBusy) return;
    if (!this.notesDirty) { this.notesOpen = false; action(); return; }
    AlertDialog.show({ message: '随记尚未保存，确定放弃修改吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.notesDirty = false;
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
        this.qaDirty = false; this.qaPending = false; this.qaOpen = false; action();
      } } });
  }

  private switchQaSession(id: string): void {
    if (this.qaBusy) return;
    const change = (): void => {
      this.qaDirty = false; this.qaPending = false;
      this.navigationOpen = false;
      this.qaSessionId = id; this.qaRequestRevision++;
    };
    if (!this.qaDirty && !this.qaPending) { change(); return; }
    AlertDialog.show({ message: this.qaPending ? '当前问答尚未保存，确定切换会话吗？' : '问答输入尚未提交，确定切换会话吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃', fontColor: $r('app.color.error'), action: change } });
  }

  private openQa(): void {
    if (this.notesOpen) { this.confirmNotesLeave(() => this.openQa()); return; }
    this.confirmDiscard(() => {
      this.draftText = this.savedText;
      this.editorInitialText = this.savedText;
      this.previewText = this.savedText;
      this.qaOpen = true; this.notesOpen = false; this.favoritesOpen = false; this.statsOpen = false;
      this.navigationOpen = false; this.closeSearch();
      this.qaNavigation.loadQaNavigation();
    });
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
      toolbarActionsWidth(['内部链接', '插入图片']) + 8 : 0;
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
    return this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE && !this.sourceMode &&
      !this.splitMode && this.outlineHeadings().length > 0;
  }

  private outlineHeadings(): LogOutlineHeading[] {
    const headings: LogOutlineHeading[] = [];
    const used: Map<string, number> = new Map<string, number>();
    let inFence = false;
    this.previewText.split('\n').forEach((line: string) => {
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

  private async addOutlineFavorite(heading: LogOutlineHeading): Promise<void> {
    if (!this.selectedDate || this.favoriteBusy) return;
    this.favoriteBusy = true;
    try {
      const request: AddFavoriteRequest = {
        date: this.selectedDate, headingText: heading.text, headingId: heading.id, level: heading.level
      };
      const response = await apiClient.post<AddFavoriteResponse>('/favorites', request);
      this.favoritesData.favorites = [...this.favoritesData.favorites, response.favorite];
      appFeedback.show('收藏成功', 'success');
    } catch (error) { appFeedback.show(error instanceof ApiError ? error.message : '收藏失败', 'error'); }
    finally { this.favoriteBusy = false; }
  }

  private removeOutlineFavorite(favorite: FavoriteHeading): void {
    AlertDialog.show({ message: `取消收藏“${favorite.headingText}”吗？`,
      primaryButton: { value: '保留', action: () => {} },
      secondaryButton: { value: '取消收藏', action: async () => {
        if (await this.favoritesData.remove(favorite.id)) appFeedback.show('已取消收藏', 'success');
        else appFeedback.show(this.favoritesData.errorMessage, 'error');
      } } });
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
    AlertDialog.show({ message: '当前日志修改尚未保存，是否放弃修改？', autoCancel: false,
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.dirty = false;
        this.reportDraft();
        next();
      } }
    });
  }

  private async switchMode(source: boolean, split: boolean = false): Promise<void> {
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
    this.sourceMode = source;
    this.splitMode = split;
    this.updateToolbarWidth(this.headerWidth);
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
    this.confirmDiscard(() => {
      this.closeSearch();
      this.openInternalLink(result.date, result.headings.includes(heading) ? heading : '', 'search', query);
    });
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
      if (lifecycle === this.lifecycle) this.errorMessage = this.message(error as Error);
    } finally {
      if (lifecycle === this.lifecycle) this.monthsLoading = false;
    }
  }

  private async loadDays(month: string, targetDate: string = ''): Promise<void> {
    const lifecycle = this.lifecycle;
    const revision = ++this.listRevision;
    this.dayRevision++;
    this.month = month;
    this.days = [];
    this.day = undefined;
    this.selectedDate = '';
    this.daysLoading = true;
    this.navigationError = '';
    try {
      const response = await this.reads.days(month);
      if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
      if (!Array.isArray(response.days)) throw new Error('日期响应格式异常');
      this.days = response.days;
      if (targetDate) await this.loadDay(targetDate);
      else if (response.days.length > 0) await this.loadDay(response.days[0].date);
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.listRevision) {
        this.navigationError = this.message(error as Error);
        this.errorMessage = this.navigationError;
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.listRevision) this.daysLoading = false;
    }
  }

  private async loadDay(date: string, heading: string = '', headingIndex: number = -1): Promise<void> {
    const lifecycle = this.lifecycle;
    const revision = ++this.dayRevision;
    this.dayLoading = true;
    this.errorMessage = '';
    this.day = undefined;
    this.editorReady = false;
    this.dirty = false;
    this.selectedDate = date;
    try {
      const response = await this.reads.day(date);
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      if (!response.day || response.day.date !== date || typeof response.day.content !== 'string') {
        throw new Error('日块响应格式异常');
      }
      this.day = response.day;
      this.activeOutlineIndex = Math.max(0, headingIndex);
      const body = this.bodyFromDay(response.day);
      const restore = !this.restoredDraftApplied ? restoredLogDraft(this.initialDraft,
        activeInstance.namespace, date, body, response.day.version) : undefined;
      if (this.initialDraft?.namespace === activeInstance.namespace && this.initialDraft.date === date) {
        this.restoredDraftApplied = true;
      }
      this.savedText = body;
      this.draftBaseVersion = restore ? this.initialDraft!.baseVersion : response.day.version;
      this.draftText = restore ? restore.text : body;
      this.editorInitialText = this.draftText;
      this.previewText = this.draftText;
      this.dirty = this.draftText !== body;
      this.reportDraft();
      this.saveError = restore?.conflict ?
        '已恢复本机草稿，但服务器版本已变化。请核对后复制草稿并刷新，保存不会覆盖新版本。' : '';
      this.targetHeading = heading;
      this.targetHeadingIndex = headingIndex;
      if (heading) this.targetRevision++;
      this.navigationOpen = false;
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.errorMessage = this.message(error as Error);
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.dayLoading = false;
    }
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
      this.navigationOpen = false;
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
      if (this.showToolbarLabels('navigation')) {
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
      .width(this.showToolbarLabels('navigation') ? undefined : 32).height(32)
      .padding({ left: this.showToolbarLabels('navigation') ? 12 : 0,
        right: this.showToolbarLabels('navigation') ? 12 : 0 })
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
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(16).fontColor([$r('app.color.body')])
          }.width(34).height(34).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
            .id('sidebar_collapse').accessibilityText('折叠侧栏')
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
        onDay: (date: string) => { if (date !== this.selectedDate) this.confirmDiscard(() => this.loadDay(date)); },
        onHeading: (day: DaySummary, heading: string, index: number) => this.openHeading(day, heading, index),
        onQuery: (query: string) => this.navigationDayQuery = query,
        onToggleMonths: () => this.navigationMonthsExpanded = !this.navigationMonthsExpanded,
        onRetry: () => this.month ? this.loadDays(this.month) : this.loadMonths() })
    }
    .width('100%').height('100%')
    .backgroundColor(this.isWide() ? $r('app.color.surface_soft') : $r('app.color.canvas'))
  }

  private setDesktopNavigationCollapsed(collapsed: boolean, section: number = -1): void {
    if (collapsed === this.desktopNavigationCollapsed || this.sidebarAnimating) return;
    const revision = ++this.sidebarMotionRevision;
    const origin = this.desktopNavigationCollapsed ? 0 : 1;
    const target = collapsed ? 0 : 1;
    const started = Date.now();
    this.sidebarExpansion = origin;
    this.sidebarAnimating = true;
    this.desktopNavigationCollapsed = collapsed;
    const step = (): void => {
      if (revision !== this.sidebarMotionRevision) return;
      const progress = Math.min(1, (Date.now() - started) / 240);
      this.sidebarExpansion = origin + (target - origin) * progress * progress * (3 - 2 * progress);
      if (progress < 1) this.getUIContext().postFrameCallback(new FrameAction(step));
      else {
        this.sidebarAnimating = false;
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
      (this.desktopNavigationCollapsed ? 0 : 1));
  }

  @Builder
  private navigationRailButton(id: string, icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Image(icon).width(id === 'expand' ? 18 : 17).height(id === 'expand' ? 18 : 17)
        .objectFit(ImageFit.Contain)
        .colorFilter(iconTint(this.navigationRailHover === id || id === 'expand' ?
          $r('app.color.ink') : $r('app.color.muted')))
    }.id(`sidebar_rail_${id}`).width(38).height(38).padding(0).borderRadius(8)
      .backgroundColor(this.navigationRailHover === id ? $r('app.color.interaction_hover') :
        $r('app.color.interaction_hover_clear'))
      .hoverEffect(HoverEffect.None)
      .onHover((hovered: boolean) => this.navigationRailHover = hovered ? id : '')
      .accessibilityText(label).onClick(action)
  }

  @Builder
  private desktopNavigationRail() {
    Column({ space: 8 }) {
      this.navigationRailButton('expand', $r('app.media.rail_chevron_right'), '展开侧栏',
        () => this.expandNavigation())
      this.navigationRailButton('months', $r('app.media.rail_calendar_days'), '展开月份列表',
        () => this.expandNavigation(0))
      this.navigationRailButton('dates', $r('app.media.rail_file_text'), '展开日期列表',
        () => this.expandNavigation(2))
      this.navigationRailButton('today', $r('app.media.rail_plus'), '新建今日日志',
        () => this.openNewLog(this.calendarDate(new Date())))
    }.id('sidebar_rail').width('100%').height('100%')
      .alignItems(HorizontalAlign.Center).padding({ top: 14, bottom: 14 })
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
      if (!this.isWide()) {
        this.desktopMoreItem($r('app.media.wand_sparkles'), 'AI生成', !!this.day,
          () => this.openAiTools('generate'))
        this.desktopMoreItem($r('app.media.edit_3'), '重点标注', !!this.day,
          () => this.openAiTools('highlight'))
      }
      if (this.sourceMode || this.splitMode) {
        if (!this.editorActionsInHeader()) {
          this.desktopMoreItem($r('app.media.link_2'), '内部链接', this.editorReady && !this.linkOpening,
            () => this.openLink())
          this.desktopMoreItem($r('app.media.upload'), '插入图片', !!this.day && !this.imageBusy,
            () => this.insertImages())
        }
      } else {
        this.desktopMoreItem($r('app.media.upload'), '插入图片', !!this.day && !this.imageBusy,
          () => this.insertImages())
      }
      if (!this.documentActionsInHeader('refresh')) {
        this.desktopMoreItem($r('app.media.refresh_cw'), '刷新', !this.saving && !this.deleting,
          () => this.refreshLog())
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
      }
      this.desktopMoreItem($r('app.media.download'), '导出全部日志', !this.exportBusy,
        () => this.exportLogs('all'))
    }.width(this.isWide() ? 220 : '100%').padding(8)
  }

  @Builder
  private compactMoreActionsPanel() {
    Column() {
      ActionPanelHeader({ title: '日志操作', showDragBar: true,
        closeLabel: '关闭日志操作', onClose: () => this.moreOpen = false })
      this.moreActions()
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 18 })
      .backgroundColor($r('app.color.canvas'))
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
  private compactNavigationContent() {
    if (this.notesOpen) {
      NotesNavigation({ noteYearFilter: this.noteYearFilter, noteTagFilter: this.noteTagFilter,
        noteCount: this.noteCount, noteYears: this.noteYears, noteTags: this.noteTags,
        noteEditorBusy: this.notesBusy,
        onNew: () => { this.noteNewRevision++; this.navigationOpen = false; },
        onYear: (year: string) => { this.noteYearFilter = year; this.navigationOpen = false; },
        onTag: (tag: string) => { this.noteTagFilter = tag; this.navigationOpen = false; } })
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
      StatsNavigation({ monthsOnly: true, statsMonths: this.statsMonths, statsMonth: this.statsMonth,
        statsMonthsLoading: this.statsMonthsLoading, statsMonthsError: this.statsMonthsError,
        onMonth: (month: string) => {
          this.statsMonth = month; this.statsMonthRevision++; this.navigationOpen = false;
        }, onRetry: () => this.statsRefreshRevision++ })
    } else this.navigation()
  }

  @Builder
  private exportActions() {
    Column({ space: 4 }) {
      Button('当前日块', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('day'))
      Button('当前源文件', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('file'))
      Button('全部日志', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!this.exportBusy).onClick(() => this.exportLogs('all'))
    }.width(150).padding(8)
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
          onAction: () => this.exportMenuOpen = true })
          .bindPopup(this.exportMenuOpen, { builder: this.exportActions(), placement: Placement.BottomRight,
            enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
            onStateChange: (event) => { if (!event.isVisible) this.exportMenuOpen = false; } })
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
          enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
          onStateChange: (event) => { if (!event.isVisible) this.moreOpen = false; } })
    }
  }

  @Builder
  private heading() {
    if (this.isWide()) {
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
    } else {
      CompactLogHeader({ selectedDate: this.selectedDate, workspaceBreakpoint: this.workspaceBreakpoint,
        sourceMode: this.sourceMode, saving: this.saving, dirty: this.editorReady && this.dirty,
        moreOpen: $moreOpen, moreActionsPanel: (): void => this.compactMoreActionsPanel(),
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
                .onClick(() => {
                  const favorite = this.outlineFavorite(heading);
                  if (favorite) this.removeOutlineFavorite(favorite);
                  else this.addOutlineFavorite(heading);
                })
            }
            }.width('100%').padding({ right: 3 })
              .backgroundColor(this.activeOutlineIndex === index ? $r('app.color.surface_soft') : Color.Transparent)
              .border({ width: { left: this.activeOutlineIndex === index ? 2 : 0 },
                color: $r('app.color.primary') }).borderRadius(6)
          }
        }, (heading: LogOutlineHeading) => heading.id)
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.width(224).height('100%').padding({ left: 8, right: 8, top: 28, bottom: 18 })
      .border({ width: { left: 1 }, color: $r('app.color.hairline_soft') })
  }

  private async importAiMaterial(): Promise<void> {
    if (this.ai.importing || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const instance = activeInstance.revision;
    this.ai.importing = true;
    try {
      const document = await new LogAiMaterialImport(
        this.getUIContext().getHostContext() as common.UIAbilityContext).pickAndExtract();
      if (!document || lifecycle !== this.lifecycle || instance !== activeInstance.revision) return;
      this.ai.material = `${this.ai.material}\n\n[文件：${document.fileName}]\n${document.text}`.trim();
      this.ai.message = (document.warnings || []).join('\n');
    } catch (error) {
      if (lifecycle === this.lifecycle) this.ai.message = error instanceof Error ? error.message : '材料导入失败';
    } finally { if (lifecycle === this.lifecycle) this.ai.importing = false; }
  }

  private async highlightAiDraft(): Promise<void> {
    if (!this.day || !this.editorReady) return;
    try {
      const date = this.day.date;
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || this.day?.date !== date) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
      await this.ai.highlight(date, snapshot.text);
    } catch (error) { this.ai.message = error instanceof Error ? error.message : '编辑器尚未就绪'; }
  }

  private async applyAiOutput(): Promise<void> {
    if (!this.day || !this.ai.output.trim() || this.ai.busy) return;
    const lifecycle = this.lifecycle;
    const date = this.day.date;
    if (this.ai.outputDate !== date) { this.ai.message = '请切回生成草稿时的日块'; return; }
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || this.day?.date !== date) return;
      for (let attempt = 0; attempt < 50 && this.editor.loadedDocumentKey !== date; attempt += 1) {
        if (lifecycle !== this.lifecycle || this.day?.date !== date) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      if (!this.editorReady || this.editor.loadedDocumentKey !== date) {
        throw new Error('编辑器尚未就绪，请稍后重试');
      }
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || lifecycle !== this.lifecycle || this.day?.date !== date) return;
      const body = snapshot.text.trimEnd();
      await this.editor.replace(`${body}${body ? '\n\n' : ''}${this.ai.output.trim()}\n`);
      if (lifecycle !== this.lifecycle || this.day?.date !== date) return;
      this.sourceMode = true; this.splitMode = false;
      appFeedback.show('AI 草稿已写入当前编辑草稿，尚未保存');
    } catch (error) { this.ai.message = error instanceof Error ? error.message : '写入编辑草稿失败'; }
  }

  private async applyAiHighlight(): Promise<void> {
    if (!this.day || !this.editorReady || this.ai.busy) return;
    const date = this.day.date;
    try {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || this.ai.highlightDate !== date ||
        snapshot.text !== this.ai.originalDraft) {
        this.ai.message = '当前日块或编辑草稿已变化，请重新标注重点'; return;
      }
      await this.editor.replace(this.ai.highlighted);
      if (this.day?.date !== date) return;
      this.ai.reviewOpen = false;
      this.sourceMode = true; this.splitMode = false;
      appFeedback.show('已应用重点标注，尚未保存');
    } catch (error) { this.ai.message = error instanceof Error ? error.message : '应用重点标注失败'; }
  }

  private openAiTools(mode: string = 'generate'): void {
    this.aiMode = mode;
    if (!this.isWide()) { this.aiOffset = 420; this.aiOpen = true; return; }
    if (this.aiOpen && !this.aiClosing) return;
    this.aiClosing = false;
    this.aiOpen = true;
    this.moveAiTools(0);
  }

  private closeAiTools(): void {
    if (!this.isWide()) { this.aiMotionRevision++; this.aiAnimating = false; this.aiOffset = 420;
      this.toolbarMotionWidth = -1; this.toolbarActionWidths = []; this.aiOpen = false; return; }
    if (!this.aiOpen || this.aiClosing) return;
    this.aiClosing = true;
    this.moveAiTools(420);
  }

  private moveAiTools(target: number): void {
    const revision = ++this.aiMotionRevision;
    this.aiAnimating = true;
    const origin = this.aiOffset;
    const actions = ['refresh', 'export', 'backup', 'delete'];
    const labels = ['刷新', '导出', '备份', '删除'];
    const originalWidths = actions.map((action: string, index: number) =>
      this.desktopActionSlotWidth(action, labels[index]));
    this.toolbarActionWidths = originalWidths;
    this.toolbarMotionWidth = Math.max(0, this.aiAvailableWidth - this.desktopNavigationWidth() -
      (target === 0 ? this.aiPanelWidth : 52));
    this.getUIContext().animateTo({ duration: 240, curve: Curve.EaseInOut }, () => {
      this.updateToolbarWidth(this.toolbarMotionWidth);
    });
    const targetWidths = actions.map((action: string, index: number) =>
      !this.documentActionsInHeader(action) ? 0 :
        (this.showToolbarLabels(action) ? toolbarActionWidth(labels[index]) : 40));
    const started = Date.now();
    const step = (): void => {
      if (revision !== this.aiMotionRevision) return;
      if (!this.isWide()) {
        this.aiOffset = 420;
        this.aiAnimating = false;
        this.toolbarMotionWidth = -1;
        this.toolbarActionWidths = [];
        if (target === 420) this.aiOpen = false;
        this.aiClosing = false;
        return;
      }
      const progress = Math.min(1, Math.max(0, (Date.now() - started) / 240));
      const eased = progress * progress * (3 - 2 * progress);
      this.aiOffset = origin + (target - origin) * eased;
      this.toolbarActionWidths = originalWidths.map((width: number, index: number) =>
        width + (targetWidths[index] - width) * eased);
      if (progress < 1) this.getUIContext().postFrameCallback(new FrameAction(step));
      else {
        this.aiAnimating = false;
        if (target === 420) {
          this.aiOpen = false;
          this.aiClosing = false;
        }
        this.getUIContext().postFrameCallback(new FrameAction(() => {
          if (revision !== this.aiMotionRevision) return;
          this.toolbarMotionWidth = -1;
          this.toolbarActionWidths = [];
        }));
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
    .translate({ x: this.isWide() ? this.aiPanelWidth * this.aiOffset / 420 : 0 })
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
      this.heading()
      if (this.monthsLoading || this.daysLoading || this.dayLoading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在加载日志').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.errorMessage) {
        LoadFailure({ message: this.errorMessage,
          onRetry: () => this.month ? this.selectedDate ? this.loadDay(this.selectedDate) : this.loadDays(this.month) :
            this.loadMonths() })
      } else if (this.day) {
        Stack({ alignContent: Alignment.Bottom }) {
          Row() {
            SourceEditor({ session: this.editor, documentKey: this.day.date,
              initialText: this.editorInitialText })
              .width(this.isWide() && this.splitMode ? '50%' : (this.sourceMode || this.splitMode ? '100%' : 0))
              .height('100%')
              .visibility(this.sourceMode || this.splitMode ? Visibility.Visible : Visibility.None)
              .border({ width: { right: this.isWide() && this.splitMode ? 1 : 0 },
                color: $r('app.color.hairline') })
            Row() {
              MarkdownReader({ content: this.previewText, contentMode: 'log', documentKey: this.day.date,
                targetHeading: this.targetHeading, targetHeadingIndex: this.targetHeadingIndex,
                targetKind: this.targetKind, targetQuery: this.targetQuery, targetRevision: this.targetRevision,
                trackActiveHeading: this.showDesktopOutline(),
                onActiveHeading: (headingId: string) => this.updateActiveOutline(headingId),
                onInternalLink: (date: string, heading: string) => this.confirmDiscard(() => this.openInternalLink(date, heading)) })
                .layoutWeight(1).height('100%')
              if (this.showDesktopOutline()) this.desktopOutline()
            }.width(this.isWide() && this.splitMode ? '50%' :
              (this.sourceMode || this.splitMode && !this.isWide() ? 0 : '100%'))
              .height('100%').visibility(this.sourceMode || this.splitMode && !this.isWide() ?
                Visibility.None : Visibility.Visible)
          }.width('100%').height('100%')
          if (this.saveError) {
            Text(this.saveError).fontSize(13).fontColor($r('app.color.error'))
              .width('100%').padding(12).backgroundColor($r('app.color.surface_soft'))
          }
        }.layoutWeight(1).width('100%')
      } else {
        EmptyState({ title: '暂无学习日志', description: '当前实例还没有可阅读的日志。' })
      }
    }.layoutWeight(1).height('100%')
  }

  build() {
    Stack() {
      Column() {
        if (this.isWide()) {
        Row({ space: 12 }) {
          if (!this.isWide() && !this.statsOpen && !this.favoritesOpen && !this.notesOpen && !this.qaOpen) {
            Button({ type: ButtonType.Normal }) {
              SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(20).fontColor([$r('app.color.ink')])
            }.width(42).height(42).backgroundColor(Color.Transparent).accessibilityText('打开日期导航')
              .onClick(() => this.navigationOpen = true)
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
          if (this.isWide()) {
            Stack({ alignContent: Alignment.TopStart }) {
              SearchField({ value: this.searchQuery,
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
                  if (!workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) return false;
                  this.closeSearch(); return true;
                } })
              this.desktopSearchResults()
            }.width(384).height(42).zIndex(40)
          } else {
            ToolbarAction({ label: '搜索日志内容', icon: $r('app.media.search'),
              showLabel: false, onAction: () => this.searchOpen = true })
          }
            ToolbarAction({ label: '随记', icon: $r('app.media.tab_lightbulb_active'),
              showLabel: this.isWide(), active: this.notesOpen,
              onAction: () => this.notesOpen ? this.confirmNotesLeave(() => {}) : this.openNotes() })
            ToolbarAction({ label: '收藏', icon: $r('app.media.tab_star_active'),
              showLabel: this.isWide(), active: this.favoritesOpen,
              onAction: () => this.favoritesOpen ? this.favoritesOpen = false : this.openFavorites() })
            ToolbarAction({ label: '问答', icon: $r('app.media.tab_message_square_text_active'),
              showLabel: this.isWide(), active: this.qaOpen,
              onAction: () => this.qaOpen ? this.confirmQaLeave(() => {}) : this.openQa() })
            ToolbarAction({ label: '统计', icon: $r('app.media.tab_chart_column'),
              showLabel: this.isWide(), active: this.statsOpen,
              onAction: () => this.statsOpen ? this.statsOpen = false : this.openStats() })
          ToolbarAction({ label: '更多设置', icon: $r('app.media.more_horizontal'), showLabel: false,
            active: this.topMoreOpen, onAction: () => this.topMoreOpen = !this.topMoreOpen })
            .bindPopup(this.topMoreOpen, { builder: this.topMoreActions(), placement: Placement.BottomRight,
              enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
              onStateChange: (event) => { if (!event.isVisible) this.topMoreOpen = false; } })
        }.width('100%').height(64).padding({ left: 12, right: 12 })
          .backgroundColor($r('app.color.canvas'))
          .zIndex(30)
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        } else {
          AppTopBar({ title: this.notesOpen ? '随记' : this.favoritesOpen ? '收藏中心' :
            this.qaOpen ? '知识问答' : this.statsOpen ? '学习统计' : '学习日志',
            onOpenNavigation: () => this.navigationOpen = true,
            onOpenSearch: () => this.searchOpen = true,
            onOpenMore: () => this.topMoreOpen = true })
            .bindPopup(this.topMoreOpen, { builder: this.topMoreActions(), placement: Placement.BottomRight,
              enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
              onStateChange: (event) => { if (!event.isVisible) this.topMoreOpen = false; } })
        }
        Stack() {
          if (this.qaOpen) {
            Row() {
              if (this.isWide()) {
                Column() {
                  Row() {
                    Text('知识问答').fontSize(14).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.body_strong'))
                  }.width('100%').height(52).padding({ left: 16 })
                    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
                  QaNavigation({ qaSessions: this.qaNavigation.qaSessions, qaSessionQuery: this.qaQuery,
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
                    .layoutWeight(1)
                }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
                  .height('100%').backgroundColor($r('app.color.surface_soft'))
                  .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                  .border({ width: { right: 1 }, color: $r('app.color.hairline') })
              }
              QaPage({ navigationSessionId: this.qaSessionId, navigationRequestRevision: this.qaRequestRevision,
                configured: !!activeInstance.capabilities?.features.rag.configured,
                onSessionsChange: (sessions: RagSessionSummary[]) => this.qaNavigation.acceptQaNavigation(sessions),
                onSessionsError: (message: string) => this.qaNavigation.qaNavigationError = message,
                onActiveSessionChange: (id: string) => this.qaSessionId = id,
                onBusyChange: (busy: boolean) => this.qaBusy = busy,
                onDraftChange: (dirty: boolean) => this.qaDirty = dirty,
                onPendingChange: (pending: boolean) => this.qaPending = pending,
                onOpenLog: () => this.confirmQaLeave(() => {}),
                onCitation: (date: string, heading: string, headingIndex: number) =>
                  this.openQaCitation(date, heading, headingIndex) }).layoutWeight(1)
            }.width('100%').height('100%')
          } else if (this.notesOpen) {
            Row() {
              if (this.isWide()) {
                Column() {
                  Row({ space: 7 }) {
                    Image($r('app.media.tab_lightbulb_active')).width(19).height(19)
                    Text('随记').fontSize(14).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.body_strong'))
                  }.width('100%').height(52).padding({ left: 16, right: 10 })
                    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
                  NotesNavigation({ noteYearFilter: this.noteYearFilter, noteTagFilter: this.noteTagFilter,
                    noteCount: this.noteCount, noteYears: this.noteYears, noteTags: this.noteTags,
                    noteEditorBusy: this.notesBusy,
                    onNew: () => this.noteNewRevision++,
                    onYear: (year: string) => this.noteYearFilter = year,
                    onTag: (tag: string) => this.noteTagFilter = tag })
                }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
                  .height('100%').backgroundColor($r('app.color.surface_soft'))
                  .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                  .border({ width: { right: 1 }, color: $r('app.color.hairline') })
              }
              NotesPage({ navigationYear: this.noteYearFilter, navigationTag: this.noteTagFilter,
                navigationNewRevision: this.noteNewRevision,
                onNavigationDataChange: (years: StudyNoteFacet[], tags: StudyNoteFacet[], total: number) => {
                  this.noteYears = years; this.noteTags = tags; this.noteCount = total;
                },
                onEditorBusyChange: (busy: boolean) => this.notesBusy = busy,
                onDirtyChange: (dirty: boolean) => this.notesDirty = dirty,
                onOpenLog: () => this.confirmNotesLeave(() => {}),
                onInternalLink: (date: string, heading: string) => this.openNoteLink(date, heading) }).layoutWeight(1)
            }.width('100%').height('100%')
          } else if (this.favoritesOpen) {
            Row() {
              if (this.isWide()) {
                Column() {
                  Row({ space: 7 }) {
                    Image($r('app.media.tab_star_active')).width(19).height(19)
                    Text('收藏中心').fontSize(14).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.body_strong'))
                  }.width('100%').height(52).padding({ left: 16, right: 10 })
                    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
                  FavoritesNavigation({ data: this.favoritesData, wide: true,
                    onRetry: () => this.favoritesData.load() })
                }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
                  .height('100%').backgroundColor($r('app.color.surface_soft'))
                  .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                  .border({ width: { right: 1 }, color: $r('app.color.hairline') })
              }
              FavoritesPage({ data: this.favoritesData, viewMode: this.favoritesViewMode,
                onViewModeChange: (mode: string) => {
                  workspacePreferences.set('favoritesView', mode)
                    .catch(() => appFeedback.show('收藏显示方式保存失败', 'error'));
                },
                onOpenLog: () => this.favoritesOpen = false,
                onOpenFavorite: (favorite: FavoriteHeading) => this.openFavorite(favorite) }).layoutWeight(1)
            }.width('100%').height('100%')
          } else if (this.statsOpen) {
            Row() {
              if (this.isWide()) {
                Column() {
                  Row() {
                    Image($r('app.media.tab_chart_column')).width(19).height(19)
                    Text('学习统计').fontSize(14).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.body_strong'))
                  }.width('100%').height(52).padding({ left: 16, right: 10 })
                    .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
                  StatsNavigation({ monthsOnly: true, statsMonths: this.statsMonths,
                    statsMonth: this.statsMonth, statsMonthsLoading: this.statsMonthsLoading,
                    statsMonthsError: this.statsMonthsError,
                    onMonth: (month: string) => {
                      this.statsMonth = month;
                      this.statsMonthRevision++;
                    },
                    onRetry: () => this.statsRefreshRevision++ })
                }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
                  .height('100%').backgroundColor($r('app.color.surface_soft'))
                  .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                  .border({ width: { right: 1 }, color: $r('app.color.hairline') })
              }
              StatsPage({ requestedMonth: this.statsMonth, requestedMonthRevision: this.statsMonthRevision,
                refreshRevision: this.statsRefreshRevision,
                onMonthsChange: (months: MonthSummary[]) => this.statsMonths = months,
                onMonthsLoadingChange: (loading: boolean) => this.statsMonthsLoading = loading,
                onMonthsErrorChange: (error: string) => this.statsMonthsError = error,
                onSelectedMonthChange: (month: string) => this.statsMonth = month,
                onOpenLog: () => this.statsOpen = false,
                onOpenEntry: (entry: StatsEntry) => this.openStatsEntry(entry) }).layoutWeight(1)
            }.width('100%').height('100%')
          } else {
          Row() {
            if (this.isWide()) {
              Stack({ alignContent: Alignment.TopStart }) {
                Column() { this.navigation() }
                  .width(this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE ? 260 : 220)
                  .height('100%')
                  .opacity(this.sidebarAnimating ? this.sidebarExpansion :
                    (this.desktopNavigationCollapsed ? 0 : 1))
                  .visibility(!this.desktopNavigationCollapsed || this.sidebarAnimating ?
                    Visibility.Visible : Visibility.Hidden)
                  .hitTestBehavior(this.desktopNavigationCollapsed || this.sidebarAnimating ?
                    HitTestMode.None : HitTestMode.Default)
                  .accessibilityLevel(this.desktopNavigationCollapsed ? 'no-hide-descendants' : 'auto')
                Column() { this.desktopNavigationRail() }.width(52).height('100%')
                  .opacity(this.sidebarAnimating ? 1 - this.sidebarExpansion :
                    (this.desktopNavigationCollapsed ? 1 : 0))
                  .visibility(this.desktopNavigationCollapsed || this.sidebarAnimating ?
                    Visibility.Visible : Visibility.Hidden)
                  .hitTestBehavior(!this.desktopNavigationCollapsed || this.sidebarAnimating ?
                    HitTestMode.None : HitTestMode.Default)
                  .accessibilityLevel(this.desktopNavigationCollapsed ? 'auto' : 'no-hide-descendants')
              }.width(this.desktopNavigationWidth())
                .height('100%').backgroundColor($r('app.color.surface_soft'))
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                .clip(this.sidebarAnimating)
                .border({ width: { right: 1 }, color: $r('app.color.hairline') })
            }
            this.reader()
            if (this.isWide()) {
              Stack({ alignContent: Alignment.TopEnd }) {
                this.aiToolsRail()
                if (this.aiOpen) this.aiToolsPanel()
                if (this.aiOpen && this.aiOffset === 0) this.aiResizer()
              }.width(52 + (this.aiPanelWidth - 52) * (1 - this.aiOffset / 420))
                .height('100%')
                .backgroundColor(this.aiOpen ? $r('app.color.canvas') : $r('app.color.surface_soft'))
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
                .border({ width: { left: 1 }, color: $r('app.color.hairline') })
                .clip(true).id('log_ai_dock')
            }
          }.width('100%').height('100%').onAreaChange((_: Area, area: Area) => {
            this.aiAvailableWidth = Number(area.width);
            this.resizeAiPanel(this.aiWidthAdjusted ? this.aiPanelWidth : 340);
            if (this.isWide() && this.aiOpen && !this.aiClosing && !this.aiAnimating && this.aiOffset === 420) {
              this.moveAiTools(0);
            }
          })
          }
          if (!this.isWide() && this.navigationOpen) {
            Row() {
              Column() {
                Row() {
                  Text(this.notesOpen ? '随记' : this.favoritesOpen ? '收藏中心' :
                    this.qaOpen ? '知识问答' : this.statsOpen ? '学习统计' : '日期')
                    .fontSize(16).fontColor($r('app.color.ink')).layoutWeight(1)
                  Button('关闭', { type: ButtonType.Normal }).fontSize(13)
                    .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
                    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
                    .height(32).padding({ left: 12, right: 12 })
                    .onClick(() => this.navigationOpen = false)
                }.height(48).padding({ left: 16, right: 16 })
                this.compactNavigationContent()
              }.width('86%').height('100%')
                .backgroundColor($r('app.color.canvas'))
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
              Blank().layoutWeight(1).height('100%').onClick(() => this.navigationOpen = false)
            }.width('100%').height('100%').backgroundColor($r('app.color.scrim'))
              .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
          }
        }.layoutWeight(1).width('100%')
        if (!this.isWide() && !this.softwareKeyboardVisible) {
          BottomNavigation({ selectedIndex: this.selectedTab(), onSelect: (index: number) => this.selectTab(index) })
        }
      }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      if (this.backupOpen && this.day) {
        Stack() {
          BackupPanel({ date: this.day.date,
            onClose: () => { if (!this.backupBusy) this.backupOpen = false; },
            onBeforeRestore: () => this.beforeRestore(),
            onRestored: (day: DayEntry) => this.applyRestoredDay(day),
            onBusyChange: (busy: boolean) => this.backupBusy = busy })
            .width(this.isWide() ? '88%' : '100%')
            .height(this.isWide() ? '88%' : '100%')
            .borderRadius(this.isWide() ? 12 : 0)
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
          .width('100%').height('100%')
      }
      if (this.aiOpen && !this.isWide() && !this.notesOpen && !this.favoritesOpen && !this.statsOpen) {
        Column() { this.aiToolsPanel() }.width('100%').height('100%')
      }
      if (this.ai.reviewOpen) {
        LogHighlightReview({ original: this.ai.originalDraft, highlighted: this.ai.highlighted,
          date: this.ai.highlightDate,
          available: this.ai.highlightDate === this.selectedDate && this.ai.originalDraft === this.draftText,
          onClose: () => this.ai.reviewOpen = false, onApply: () => this.applyAiHighlight() })
          .width('100%').height('100%')
      }
    }.width('100%').height('100%')
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}

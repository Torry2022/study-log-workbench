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
import { DesktopLogCommands, DesktopMenuEntry } from '../app/DesktopMenu';
import { DesktopTitleBar } from '../app/components/DesktopTitleBar';
import { ImagePreview } from '../common/ui/ImagePreview';
import { appFeedback } from '../common/ui/AppFeedback';
import { workspacePreferences } from '../common/storage/WorkspacePreferences';
import { SettingsPanel } from '../app/components/SettingsPanel';
import { AboutPanel } from '../app/components/AboutPanel';
import { HelpPanel } from '../app/components/HelpPanel';
import { KeyCode } from '@kit.InputKit';
import { workspaceKey } from '../common/ui/WorkspaceKeys';
import { floatingSurfaceTransition } from '../common/ui/WorkspaceMotion';

@Entry
@Component
struct Index {
  @Provide('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.COMPACT;
  @State private connected: boolean = false;
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
  private imagePreviewClosing: boolean = false;
  private desktopCommands: DesktopLogCommands = new DesktopLogCommands();
  private removeUnauthorizedHandler: () => void = () => {};
  private drafts: Map<string, PreservedLogDraft> = new Map();
  private captureDraft: () => Promise<PreservedLogDraft | undefined> = async () => undefined;
  private expiring: boolean = false;
  private draftStoreErrorShown: boolean = false;
  private preferencesReady: Promise<void> = Promise.resolve();

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
    commands.sidebarCollapsed = (collapsed: boolean, section: number): void => { if (active()) this.setDesktopNavigationCollapsed(collapsed, section); };
    commands.editorCommand = (command: string): void => { if (active()) this.editorWorkspaceCommand(command); };
    commands.focusRegion = (reverse: boolean): void => { if (active()) this.focusWorkspaceRegion(reverse); };
    commands.dispose = (): void => { if (active()) this.clearModuleNavigation(); };
    return commands;
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
    if (index === 3) this.qaNavigation.loadQaNavigation();
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
    const leave = (): void => { if (this.workspaceNavigationView !== view) return; this.modules.taxonomyDirty = false; this.modules.taxonomyOpen = false; action(); };
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
    this.selectedModule = 0;
  }

  aboutToAppear(): void {
    // Keyboard avoidance belongs to the window, not individual input focus lifetimes.
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    this.registerFonts();
    appFeedback.attach(this.getUIContext(), () => false);
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
      const draft = logDraftStore.load(namespace);
      if (draft) this.drafts.set(namespace, draft);
      else this.drafts.delete(namespace);
    } catch (_) {
      appFeedback.show('本机草稿读取失败，请检查设备存储', 'error');
    }
    if (revision !== activeInstance.revision) return;
    this.resetModules();
    this.connected = true;
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
      this.previewImageSource || this.desktopMenuOpen || this.desktopCommands.blocked()) return;
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
      this.previewImageSource || this.desktopMenuOpen || this.desktopCommands.blocked()) return;
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

  private handleWorkspaceKey(event: KeyEvent): boolean {
    if (this.settingsOpen || this.aboutOpen || this.helpOpen || this.previewImageSource) {
      if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) {
        if (this.settingsOpen) this.settingsOpen = false;
        else if (this.aboutOpen) this.aboutOpen = false;
        else if (this.helpOpen) this.helpOpen = false;
        else this.closeImagePreview();
      }
      return true;
    }
    if (event.keyCode === KeyCode.KEYCODE_ALT_LEFT || event.keyCode === KeyCode.KEYCODE_ALT_RIGHT) {
      if (event.type === KeyType.Down) this.altPressedAlone = true;
      else if (this.altPressedAlone && this.desktopWindowChrome && this.connected && !this.desktopMenuOpen &&
        !this.desktopCommands.blocked()) {
        this.altPressedAlone = false;
        this.menuFocusRevision++;
        return true;
      }
      return false;
    }
    if (event.type !== KeyType.Down) return false;
    this.altPressedAlone = false;
    if (!this.connected || this.desktopMenuOpen) return false;
    if (this.desktopCommands.handleKey(event)) return true;
    if (this.desktopCommands.blocked()) return false;
    if (workspaceKey(event, KeyCode.KEYCODE_F1)) { this.openHelp(); return true; }
    if (workspaceKey(event, KeyCode.KEYCODE_F10) && this.desktopWindowChrome) {
      this.menuFocusRevision++;
      return true;
    }
    return false;
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
        LogsReaderPage({ selectedModule: $selectedModule, modules: this.modules, desktopWindowChrome: this.desktopWindowChrome,
          workspaceTransition: this.workspaceTransition, reading: this.reading, readingTransition: this.readingTransition, sidebar: this.sidebar,
          onRegisterNavigation: (view: WorkspaceNavigationView) => this.registerWorkspaceNavigation(view),
          search: this.search, searchOpen: $searchOpen, logNavigation: this.logNavigation,
          favoritesData: this.favoritesData, qaNavigation: this.qaNavigation, onChangeServer: () => this.changeServer(), onOpenSettings: () => this.settingsOpen = true,
          onSetTheme: (value: string) => this.setTheme(value),
          onOpenAbout: () => this.aboutOpen = true,
          onOpenHelp: () => this.openHelp(),
          onRegisterDesktopCommands: (commands: DesktopLogCommands) => this.desktopCommands = commands,
          initialDraft: this.drafts.get(activeInstance.namespace),
          onDraftChange: (namespace: string, draft: PreservedLogDraft | undefined) =>
            this.recordDraft(namespace, draft),
          onCaptureDraft: (capture: () => Promise<PreservedLogDraft | undefined>) => this.captureDraft = capture })
      } else {
        LoginPage({ restoreOnAppear: this.restoreOnAppear,
          onConnected: (origin: string, capabilities: InstanceCapabilities) => this.connectedTo(origin, capabilities) })
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
  }
}

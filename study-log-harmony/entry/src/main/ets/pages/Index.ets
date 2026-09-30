import { fileIo } from '@kit.CoreFileKit';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { WorkspaceBreakpoint, THEME_PREFERENCES } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance } from '../common/network/InstanceConfig';
import { apiClient } from '../common/network/ApiClient';
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
  private imagePreviewClosing: boolean = false;
  private desktopCommands: DesktopLogCommands = new DesktopLogCommands();
  private removeUnauthorizedHandler: () => void = () => {};
  private drafts: Map<string, PreservedLogDraft> = new Map();
  private captureDraft: () => Promise<PreservedLogDraft | undefined> = async () => undefined;
  private expiring: boolean = false;
  private draftStoreErrorShown: boolean = false;
  private preferencesReady: Promise<void> = Promise.resolve();

  aboutToAppear(): void {
    this.registerFonts();
    appFeedback.attach(this.getUIContext(), () => false);
    this.preferencesReady = workspacePreferences.initialize(this.getUIContext().getHostContext() as common.UIAbilityContext);
    this.removeUnauthorizedHandler = apiClient.setUnauthorizedHandler(() => { this.expireSession(); });
  }

  aboutToDisappear(): void { this.removeUnauthorizedHandler(); appFeedback.detach(); }

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
    this.selectedModule = 0;
    this.connected = true;
  }

  private changeServer(): void {
    apiClient.setToken('');
    activeInstance.activate('', '');
    this.restoreOnAppear = false;
    this.connected = false;
  }

  private updateBreakpoint(width: number): void {
    this.workspaceBreakpoint = width < 600 ? WorkspaceBreakpoint.COMPACT :
      width < 840 ? WorkspaceBreakpoint.MEDIUM :
        width < 1440 ? WorkspaceBreakpoint.LARGE : WorkspaceBreakpoint.EXTRA_LARGE;
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
        LogsReaderPage({ selectedModule: $selectedModule, onChangeServer: () => this.changeServer(), onOpenSettings: () => this.settingsOpen = true,
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

import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { WorkspaceBreakpoint } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance } from '../common/network/InstanceConfig';
import { apiClient } from '../common/network/ApiClient';
import { LoginPage } from '../app/LoginPage';
import { TokenStore } from '../common/storage/TokenStore';
import { LogsReaderPage, PreservedLogDraft } from '../features/logs/LogsReaderPage';
import { DesktopLogCommands, DesktopMenuEntry } from '../app/DesktopMenu';
import { DesktopTitleBar } from '../app/components/DesktopTitleBar';
import { ImagePreview } from '../common/ui/ImagePreview';
import { appFeedback } from '../common/ui/AppFeedback';
import { workspacePreferences } from '../common/storage/WorkspacePreferences';
import { SettingsPanel } from '../app/components/SettingsPanel';
import { AboutPanel } from '../app/components/AboutPanel';

@Entry
@Component
struct Index {
  @Provide('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.COMPACT;
  @State private connected: boolean = false;
  @State private restoreOnAppear: boolean = true;
  @StorageLink('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  @StorageLink('previewImageSource') private previewImageSource: string = '';
  @State private imagePreviewOpacity: number = 0;
  @State private settingsOpen: boolean = false;
  @State private aboutOpen: boolean = false;
  private imagePreviewClosing: boolean = false;
  private desktopCommands: DesktopLogCommands = new DesktopLogCommands();
  private removeUnauthorizedHandler: () => void = () => {};
  private drafts: Map<string, PreservedLogDraft> = new Map();
  private captureDraft: () => Promise<PreservedLogDraft | undefined> = async () => undefined;
  private expiring: boolean = false;

  aboutToAppear(): void {
    this.registerFonts();
    appFeedback.attach(this.getUIContext(), () => false);
    workspacePreferences.initialize(this.getUIContext().getHostContext() as common.UIAbilityContext);
    this.removeUnauthorizedHandler = apiClient.setUnauthorizedHandler(() => { this.expireSession(); });
  }

  aboutToDisappear(): void { this.removeUnauthorizedHandler(); appFeedback.detach(); }

  private async expireSession(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    try {
      const draft = await this.captureDraft();
      if (draft) this.drafts.set(draft.namespace, draft);
    } catch (_) { /* Retain the last editor change already recorded. */ }
    apiClient.setToken('');
    this.restoreOnAppear = false;
    await TokenStore.clear().catch(() => {});
    this.connected = false;
    this.expiring = false;
  }

  private recordDraft(draft: PreservedLogDraft | undefined): void {
    if (draft) this.drafts.set(draft.namespace, draft);
    else if (activeInstance.namespace) this.drafts.delete(activeInstance.namespace);
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

  private connectedTo(_origin: string, _capabilities: InstanceCapabilities): void {
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

  private windowMenuEntries(menu: string): DesktopMenuEntry[] {
    if (menu === '帮助') return [new DesktopMenuEntry('about', '关于学习日志工作台',
      this.connected && !this.aboutOpen && !this.settingsOpen)];
    const entries = this.desktopCommands.entries(menu);
    const available = entries.map((entry: DesktopMenuEntry) => new DesktopMenuEntry(entry.id, entry.label,
      this.connected && entry.enabled, entry.checked, entry.shortcut));
    if (menu === '编辑') available.push(new DesktopMenuEntry('settings', '设置', this.connected && !this.settingsOpen));
    return available;
  }

  private executeWindowMenu(id: string): void {
    const enabled = ['文件', '编辑', '视图', '帮助'].flatMap((menu: string) => this.windowMenuEntries(menu))
      .some((entry: DesktopMenuEntry) => entry.id === id && entry.enabled);
    if (enabled && id === 'settings') this.settingsOpen = true;
    else if (enabled && id === 'about') this.aboutOpen = true;
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

  build() {
    Column() {
      if (this.desktopWindowChrome) {
        DesktopTitleBar({ getEntries: (menu: string) => this.windowMenuEntries(menu),
          onAction: (id: string) => this.executeWindowMenu(id) })
      }
      Stack() {
      if (this.connected) {
        LogsReaderPage({ onChangeServer: () => this.changeServer(), onOpenSettings: () => this.settingsOpen = true,
          onOpenAbout: () => this.aboutOpen = true,
          onRegisterDesktopCommands: (commands: DesktopLogCommands) => this.desktopCommands = commands,
          initialDraft: this.drafts.get(activeInstance.namespace),
          onDraftChange: (draft: PreservedLogDraft | undefined) => this.recordDraft(draft),
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
      }
      if (this.aboutOpen) {
        AboutPanel({ onClose: () => this.aboutOpen = false }).zIndex(100)
      }
      }.width('100%').layoutWeight(1)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }.width('100%').height('100%')
      .onAreaChange((_oldArea, area) => this.updateBreakpoint(Number(area.width)))
  }
}

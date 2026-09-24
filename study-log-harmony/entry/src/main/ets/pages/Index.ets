import { fileIo } from '@kit.CoreFileKit';
import { WorkspaceBreakpoint } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance } from '../common/network/InstanceConfig';
import { apiClient } from '../common/network/ApiClient';
import { LoginPage } from '../app/LoginPage';
import { AppLogo } from '../common/ui/AppLogo';

@Entry
@Component
struct Index {
  @Provide('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint = WorkspaceBreakpoint.COMPACT;
  @State private connected: boolean = false;
  @State private restoreOnAppear: boolean = true;
  @State private origin: string = '';

  aboutToAppear(): void {
    this.registerFonts();
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

  private connectedTo(origin: string, _capabilities: InstanceCapabilities): void {
    this.origin = origin;
    this.connected = true;
  }

  private changeServer(): void {
    apiClient.setToken('');
    activeInstance.activate('', '');
    this.restoreOnAppear = false;
    this.connected = false;
  }

  build() {
    if (this.connected) {
      Column({ space: 16 }) {
        AppLogo({ iconSize: 52, cornerRadius: 11 })
        Text('服务已连接').fontSize(28).fontColor($r('app.color.ink'))
        Text(this.origin).fontSize(14).fontColor($r('app.color.muted'))
        Text('公开版工作区仍在逐批迁移').fontSize(14).fontColor($r('app.color.muted'))
        Button('更换服务器').backgroundColor($r('app.color.primary')).onClick(() => this.changeServer())
      }
      .width('100%').height('100%').justifyContent(FlexAlign.Center)
      .backgroundColor($r('app.color.canvas'))
    } else {
      LoginPage({ restoreOnAppear: this.restoreOnAppear,
        onConnected: (origin: string, capabilities: InstanceCapabilities) => this.connectedTo(origin, capabilities) })
    }
  }
}

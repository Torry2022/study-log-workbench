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
    let path = '/system/fonts/NotoSerifCJK-Regular.ttc';
    try { fileIo.statSync('/system/fonts/FZShuS-SC.ttf'); path = '/system/fonts/FZShuS-SC.ttf'; }
    catch (_) { /* Use the system serif fallback. */ }
    this.getUIContext().getFont().registerFont({ familyName: 'StudyLogDesktopSerif', familySrc: `file://${path}` });
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

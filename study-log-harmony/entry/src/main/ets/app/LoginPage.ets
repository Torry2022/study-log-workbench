import { ConnectionAction } from './components/ConnectionAction';
import { LoginBackdrop } from './components/LoginBackdrop';
import { ConnectionOptions } from './components/ConnectionOptions';
import { FormKeyboardContext } from '../common/ui/FormKeyboardContext';
import { apiClient, ApiError } from '../common/network/ApiClient';
import { WorkspaceBreakpoint } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance, validCapabilities } from '../common/network/InstanceConfig';
import { instanceStore } from '../common/storage/InstanceStore';
import { TokenStore } from '../common/storage/TokenStore';
import { workspaceSansFamily, workspaceSerifFamily } from '../common/ui/Typography';
import { common } from '@kit.AbilityKit';
import { ConnectionProbe } from '../common/network/ConnectionProbe';
import { ReadCancellation } from '../common/network/ReadCancellation';
import { appFeedback } from '../common/ui/AppFeedback';
import { AppLogo } from '../common/ui/AppLogo';
import { iconTint } from '../common/ui/IconTint';

function loginErrorMessage(error: Object, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (!(error instanceof Error)) return fallback;
  switch (error.message) {
    case '请输入 HTTPS 服务器地址，可包含 /study-log，不含账号或查询参数':
    case '服务器地址无效':
    case '端口无效':
    case 'HTTP 仅允许明确启用的本地或局域网测试地址':
    case '服务器连接信息已变化，请重新输入密码连接':
    case '服务器登录响应无效':
    case '服务器不支持当前客户端接口':
      return error.message;
    default:
      return fallback;
  }
}

@Component
export struct LoginPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onConnected: (origin: string, capabilities: InstanceCapabilities) => void = () => {};
  onInitialReady: () => void = () => {};
  restoreOnAppear: boolean = true;
  @Prop entryBusy: boolean = false;
  onOpenLocalSettings: () => void = () => {};
  onBackHandler: (back: () => boolean) => void = () => {};
  @State private origin: string = '';
  @State private localHttp: boolean = false;
  @State private password: string = '';
  @State private errorMessage: string = '';
  @State private submitting: boolean = false;
  @State private ready: boolean = false;
  @State private showLocalSettings: boolean = false;
  @State private originFocused: boolean = false;
  @State private passwordFocused: boolean = false;
  @State private viewportWidth: number = 0;
  @State private viewportHeight: number = 780;
  @State private committing: boolean = false;
  @State private checking: boolean = false;
  private generation: number = 0;
  private loginCancellation?: ReadCancellation;
  private formScroller: Scroller = new Scroller();
  private formKeyboard: FormKeyboardContext = new FormKeyboardContext(this.formScroller, 'login_scroll');

  async aboutToAppear(): Promise<void> {
    const generation = ++this.generation;
    this.onBackHandler(() => this.requestBack());
    let restoredConnection = false;
    try {
      await instanceStore.initialize(this.getUIContext().getHostContext() as common.Context);
      const saved = await instanceStore.restore();
      const deferred = await instanceStore.connectionDeferred();
      if (generation !== this.generation) return;
      this.showLocalSettings = deferred || !this.restoreOnAppear;
      if (!saved) return;
      this.origin = saved.origin;
      this.localHttp = saved.localHttp;
      if (deferred || !this.restoreOnAppear) return;
      activeInstance.activate(saved.origin, saved.namespace, undefined, saved.credentialId || '');
      const token = await TokenStore.read();
      if (!token || generation !== this.generation) return;
      apiClient.setToken(token);
      const capabilities = await apiClient.get<InstanceCapabilities>('/capabilities');
      if (generation !== this.generation) return;
      if (!validCapabilities(capabilities) || capabilities.instanceId !== saved.instanceId) {
        throw new Error('服务器连接信息已变化，请重新输入密码连接');
      }
      activeInstance.activate(saved.origin, saved.namespace, capabilities, saved.credentialId || '');
      restoredConnection = true;
      this.onConnected(saved.origin, capabilities);
    } catch (error) {
      if (generation !== this.generation) return;
      apiClient.setToken('');
      if (error instanceof ApiError && error.statusCode === 401 && activeInstance.namespace) {
        this.errorMessage = '登录已过期，请重新输入密码';
      } else {
        this.errorMessage = loginErrorMessage(error, '无法恢复连接，请检查服务器地址和网络后重试');
      }
    } finally {
      if (generation === this.generation) {
        this.ready = true;
        if (!restoredConnection) this.onInitialReady();
      }
    }
  }

  aboutToDisappear(): void {
    this.generation++;
    this.onBackHandler(() => false);
    this.formKeyboard.clear(); this.password = '';
    this.loginCancellation?.cancel();
  }

  private cancelCheck(): boolean {
    if (this.committing || this.submitting && !this.checking) return false;
    if (this.submitting) {
      this.generation++;
      this.loginCancellation?.cancel();
      this.loginCancellation = undefined;
      this.submitting = false; this.checking = false;
    }
    this.password = ''; this.formKeyboard.clear();
    this.getUIContext().getFocusController().clearFocus();
    return true;
  }

  private requestBack(): boolean {
    if (!this.ready || !this.submitting) return false;
    this.cancelCheck();
    return true;
  }

  private async submit(): Promise<void> {
    if (this.submitting || !this.ready || this.entryBusy) return;
    if (!this.password) {
      this.errorMessage = '请输入访问密码';
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    const generation = ++this.generation;
    const cancellation = new ReadCancellation();
    this.loginCancellation = cancellation;
    this.checking = true;
    let credentialId = '';
    let committed = false;
    try {
      const previous = await instanceStore.restore();
      if (generation !== this.generation) return;
      const previousCredential = previous ? previous.credentialId || previous.namespace : '';
      const candidate = await new ConnectionProbe().check({ origin: this.origin, password: this.password, localHttp: this.localHttp }, cancellation);
      if (generation !== this.generation) return;
      this.checking = false;
      const saved = await instanceStore.prepare(candidate.origin, candidate.capabilities, candidate.localHttp);
      if (generation !== this.generation) return;
      this.committing = true;
      credentialId = await TokenStore.stage(candidate.token);
      if (generation !== this.generation) return;
      saved.credentialId = credentialId;
      instanceStore.commit(saved, candidate.capabilities);
      committed = true;
      apiClient.setToken(candidate.token);
      if (previousCredential) await TokenStore.removeCredential(previousCredential);
      try { await instanceStore.setConnectionDeferred(false); }
      catch (_) { appFeedback.show('已连接，但自动连接偏好未能保存；下次可从待连接页重新连接', 'warning'); }
      if (generation !== this.generation) return;
      this.password = '';
      this.onConnected(candidate.origin, candidate.capabilities);
    } catch (error) {
      if (generation !== this.generation) return;
      this.errorMessage = loginErrorMessage(error, '无法连接学习日志服务，请检查服务器地址和网络');
    } finally {
      if (credentialId && !committed) await TokenStore.removeCredential(credentialId);
      if (generation === this.generation) { this.submitting = false; this.committing = false; this.checking = false; }
    }
  }

  @Builder
  private settingsAction() {
    Button({ type: ButtonType.Normal }) {
      Image($r('app.media.settings_gear')).width(20).height(20)
        .colorFilter(iconTint($r('app.color.body')))
    }.width(44).height(44).padding(0).flexShrink(0)
      .backgroundColor($r('app.color.logo_surface'))
      .border({ width: 1, color: $r('app.color.hairline') })
      .borderRadius(10).clip(true)
      .id('login_local_settings').accessibilityText('设置')
      .enabled(this.ready && !this.entryBusy && !this.submitting).onClick(this.onOpenLocalSettings)
  }

  @Builder
  private identityContent(wide: boolean) {
    Column() {
      Row({ space: 14 }) {
        AppLogo({ iconSize: 52, cornerRadius: 11 }).id('login_app_icon')
        Text('学习日志').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(18)
          .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        if (!wide && this.showLocalSettings) {
          Blank().layoutWeight(1)
          this.settingsAction()
        }
      }.width('100%').alignItems(VerticalAlign.Center)
      if (wide) {
        Blank().layoutWeight(1)
      } else {
        Blank()
      }
      Column({ space: wide ? 22 : 14 }) {
        Text('学习日志\n工作台')
          .fontFamily(workspaceSerifFamily(this.workspaceBreakpoint))
          .fontSize(wide ? 58 : 38)
          .lineHeight(wide ? 60 : 39)
          .fontWeight(FontWeight.Regular)
          .fontColor($r('app.color.ink'))
        Text('记录每天的技术学习\n让日志易于检索、关联与回顾')
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(wide ? 17 : 15)
          .lineHeight(wide ? 28 : 23)
          .fontColor($r('app.color.muted'))
      }
      .id('login_identity_statement')
      .padding({ bottom: wide ? 32 : 0 })
      .width('100%').alignItems(HorizontalAlign.Start)
      if (wide) {
        Blank().layoutWeight(1)
      }
    }
    .width('100%').height('100%')
    .padding({ left: wide ? 48 : 24, right: wide ? 48 : 24, top: wide ? 40 : 24, bottom: wide ? 56 : 25 })
  }

  @Builder
  private mobileWelcome() {
    Stack({ alignContent: Alignment.TopStart }) {
      LoginBackdrop().id('login_welcome_backdrop')
      this.identityContent(false)
    }.width('100%').height(Math.max(260, Math.min(320, this.viewportHeight * 0.34))).clip(true)
  }

  @Builder
  private accessContent() {
    Column({ space: 16 }) {
      Column({ space: 6 }) {
        Text('连接工作台').fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(34)
          .fontWeight(FontWeight.Regular).fontColor($r('app.color.ink')).width('100%')
        Text('请输入工作台地址和访问密码').fontSize(14).lineHeight(21)
          .fontColor($r('app.color.muted')).width('100%')
      }.width('100%').padding({ bottom: 4 })
      Column({ space: 8 }) {
        Text('工作台地址').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(14)
          .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
        TextInput({ text: this.origin, placeholder: 'https://notes.example.com' })
          .id('login_origin_input').key('login_origin_input').tabIndex(1).accessibilityText('工作台地址')
          .height(48).fontSize(16).enabled(this.ready && !this.submitting)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontColor($r('app.color.ink')).placeholderColor($r('app.color.muted_soft'))
          .backgroundColor($r('app.color.canvas')).borderRadius(8)
          .border({ width: this.originFocused ? 2 : 1,
            color: this.originFocused ? $r('app.color.primary') : $r('app.color.hairline') })
          .onFocus(() => { this.originFocused = true; this.formKeyboard.focus(this.getUIContext(), 'login_origin_input', 'login_origin_input'); })
          .onBlur(() => { this.originFocused = false; this.formKeyboard.blur('login_origin_input'); })
          .onChange((value: string) => { this.origin = value; this.errorMessage = ''; })
      }.width('100%')
      Column({ space: 8 }) {
        Text('访问密码').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(14)
          .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
        TextInput({ text: this.password, placeholder: '输入访问密码' })
          .id('login_password_input').tabIndex(2).accessibilityText('访问密码')
          .type(InputType.Password).monopolizeEvents(true).height(48).fontSize(16)
          .enabled(this.ready && !this.submitting).fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontColor($r('app.color.ink')).placeholderColor($r('app.color.muted_soft'))
          .backgroundColor($r('app.color.canvas')).borderRadius(8)
          .border({ width: this.passwordFocused ? 2 : 1,
            color: this.passwordFocused ? $r('app.color.primary') : $r('app.color.hairline') })
          .onFocus(() => { this.passwordFocused = true; this.formKeyboard.focus(this.getUIContext(), 'login_password_input', 'login_credentials'); })
          .onBlur(() => { this.passwordFocused = false; this.formKeyboard.blur('login_password_input'); })
          .onChange((value: string) => { this.password = value; this.errorMessage = ''; })
          .onSubmit(() => this.submit())
      }.width('100%')
      ConnectionOptions({ localHttp: $localHttp, available: !this.submitting, rowId: 'login_connection_options' })
      if (this.errorMessage) Text(this.errorMessage).id('login_feedback')
        .fontSize(13).lineHeight(20).fontColor($r('app.color.error')).width('100%')
      ConnectionAction({ label: this.ready ? '连接' : '正在恢复连接', primary: true, fullWidth: true,
        busy: this.submitting || !this.ready, available: this.ready && !this.entryBusy && !!this.password && !!this.origin,
        onAction: () => { void this.submit(); } }).id('login_submit_button')
    }.id('login_credentials').width('100%').onAreaChange(() => this.formKeyboard.reveal(this.getUIContext()))
  }

  private wideLayout(): boolean {
    return this.viewportWidth >= 840;
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row().width('100%').height('100%').backgroundColor($r('app.color.canvas'))
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      Row() {
        if (this.wideLayout()) {
          Stack() {
            LoginBackdrop().id('login_welcome_backdrop')
            this.identityContent(true)
          }.width('55%').height('100%').clip(true)
            .border({ width: { right: 1 }, color: $r('app.color.hairline') })
        }
        Column() {
          if (this.wideLayout() && this.showLocalSettings) {
            Row() {
              this.settingsAction()
            }.width('100%').justifyContent(FlexAlign.End).padding({ top: 24, right: 32 })
          }
          Scroll(this.formScroller) {
            Column() {
              if (!this.wideLayout()) this.mobileWelcome()
              Column() { this.accessContent() }.width('100%').constraintSize({ maxWidth: 460 })
                .padding({ left: this.wideLayout() ? 32 : 24, right: this.wideLayout() ? 32 : 24, top: 24, bottom: 24 })
            }.width('100%').alignItems(HorizontalAlign.Center)
          }.id('login_scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto)
            .align(this.wideLayout() ? Alignment.Center : Alignment.Top)
            .onAreaChange(() => this.formKeyboard.reveal(this.getUIContext()))
        }.layoutWeight(1).height('100%')
      }.width('100%').height('100%')
    }.id('login_surface').width('100%').height('100%').onAreaChange((_old: Area, area: Area) => {
      this.viewportWidth = Number(area.width);
      this.viewportHeight = Number(area.height);
      this.formKeyboard.reveal(this.getUIContext());
    })
  }
}

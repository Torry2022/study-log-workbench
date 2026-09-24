import { apiClient, ApiError } from '../common/network/ApiClient';
import { WorkspaceBreakpoint } from '../common/AppConfig';
import { InstanceCapabilities, activeInstance, normalizeInstanceOrigin, validCapabilities } from '../common/network/InstanceConfig';
import { instanceStore } from '../common/storage/InstanceStore';
import { TokenStore } from '../common/storage/TokenStore';
import { workspaceSansFamily, workspaceSerifFamily } from '../common/ui/Typography';
import { KeyboardAvoidMode } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { AppLogo } from '../common/ui/AppLogo';

interface AppLoginResponse { ok: boolean; token: string; expiresAt: string; }
interface AppLoginRequest { password: string; }

@Component
export struct LoginPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onConnected: (origin: string, capabilities: InstanceCapabilities) => void = () => {};
  restoreOnAppear: boolean = true;
  @State private origin: string = '';
  @State private localHttp: boolean = false;
  @State private password: string = '';
  @State private errorMessage: string = '';
  @State private submitting: boolean = false;
  @State private ready: boolean = false;
  @State private originFocused: boolean = false;
  @State private passwordFocused: boolean = false;
  @State private textureOffset: number = 0;
  @State private viewportWidth: number = 0;
  @StorageLink('softwareKeyboardVisible') private softwareKeyboardVisible: boolean = false;
  private textureAnimationStarted: boolean = false;
  private previousKeyboardAvoidMode?: KeyboardAvoidMode;
  private generation: number = 0;

  async aboutToAppear(): Promise<void> {
    const generation = ++this.generation;
    try {
      await instanceStore.initialize(this.getUIContext().getHostContext() as common.Context);
      const saved = await instanceStore.restore();
      if (generation !== this.generation || !saved) return;
      this.origin = saved.origin;
      this.localHttp = saved.localHttp;
      if (!this.restoreOnAppear) return;
      activeInstance.activate(saved.origin, saved.namespace);
      const token = await TokenStore.read();
      if (!token || generation !== this.generation) return;
      apiClient.setToken(token);
      const capabilities = await apiClient.get<InstanceCapabilities>('/capabilities');
      if (generation !== this.generation) return;
      if (!validCapabilities(capabilities) || capabilities.instanceId !== saved.instanceId) {
        await TokenStore.clear();
        throw new Error('服务器实例身份已变化，请重新输入密码连接');
      }
      activeInstance.activate(saved.origin, saved.namespace, capabilities);
      this.onConnected(saved.origin, capabilities);
    } catch (error) {
      if (generation !== this.generation) return;
      apiClient.setToken('');
      if (error instanceof ApiError && error.statusCode === 401 && activeInstance.namespace) {
        await TokenStore.clear();
        if (generation !== this.generation) return;
        this.errorMessage = '登录已过期，请重新输入密码';
      } else {
        this.errorMessage = error instanceof Error ? error.message : '无法恢复连接，请重新输入密码';
      }
    } finally {
      if (generation === this.generation) this.ready = true;
    }
  }

  aboutToDisappear(): void { this.generation++; }

  private startTextureAnimation(): void {
    if (this.textureAnimationStarted) return;
    this.textureAnimationStarted = true;
    this.getUIContext().animateTo({ duration: 12000, curve: Curve.Linear, iterations: -1 }, () => {
      this.textureOffset = 200;
    });
  }

  @Builder
  private textureBackground() {
    Stack({ alignContent: Alignment.TopStart }) {
      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_belt_falling'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: -this.textureOffset - 200, y: -this.textureOffset - 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_belt_rising'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: this.textureOffset - 300, y: -this.textureOffset - 100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('100%')
        .height('100%')
        .backgroundImage($r('app.media.login_knowledge_texture'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('100%')
        .height('100%')
        .backgroundImage($r('app.media.login_knowledge_nodes'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .backgroundImagePosition({ x: -100, y: -100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_markdown_marker'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: -this.textureOffset - 200, y: -this.textureOffset - 200 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Row() {}
        .width('300%')
        .height('400%')
        .backgroundImage($r('app.media.login_markdown_marker'), ImageRepeat.XY)
        .backgroundImageSize({ width: 200, height: 200 })
        .translate({ x: this.textureOffset - 300, y: -this.textureOffset - 100 })
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.surface_soft'))
    .clip(true)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
  }

  private async submit(): Promise<void> {
    if (this.submitting || !this.ready) return;
    if (!this.password) {
      this.errorMessage = '请输入访问密码';
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    const generation = ++this.generation;
    try {
      const origin = normalizeInstanceOrigin(this.origin, this.localHttp);
      activeInstance.activate(origin, '');
      apiClient.setToken('');
      const request: AppLoginRequest = { password: this.password };
      const result = await apiClient.post<AppLoginResponse>('/auth/app-login', request);
      if (generation !== this.generation) return;
      const expiresAt = Date.parse(result.expiresAt);
      if (result.ok !== true || typeof result.token !== 'string' || !result.token ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('服务器登录响应无效');
      apiClient.setToken(result.token);
      const capabilities = await apiClient.get<InstanceCapabilities>('/capabilities');
      if (generation !== this.generation) return;
      if (!validCapabilities(capabilities)) throw new Error('服务器不支持当前公开版接口');
      await instanceStore.select(origin, capabilities, this.localHttp);
      if (generation !== this.generation) return;
      await TokenStore.write(result.token);
      if (generation !== this.generation) return;
      this.password = '';
      this.onConnected(origin, capabilities);
    } catch (error) {
      if (generation !== this.generation) return;
      apiClient.setToken('');
      this.errorMessage = error instanceof ApiError ? error.message : '无法连接学习日志服务';
      if (error instanceof Error && !(error instanceof ApiError)) this.errorMessage = error.message;
    } finally { if (generation === this.generation) this.submitting = false; }
  }

  @Builder
  private identityContent(wide: boolean) {
    Column() {
      Row({ space: 14 }) {
        AppLogo({ iconSize: 52, cornerRadius: 11 }).id('login_app_icon')
        Text('学习日志').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(18)
          .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
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
  private accessContent(wide: boolean) {
    Column() {
      Column({ space: 10 }) {
        Text('连接工作台').fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(wide ? 48 : 40)
          .fontWeight(FontWeight.Regular).fontColor($r('app.color.ink'))
        Text('输入自部署服务地址和访问密码').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(14).fontColor($r('app.color.muted'))
      }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: wide ? 28 : 24 })

      Column({ space: 8 }) {
        Text('服务器地址').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.muted')).width('100%')
        TextInput({ text: this.origin, placeholder: 'https://example.com' })
          .id('login_origin_input')
          .tabIndex(1)
          .accessibilityText('服务器地址')
          .height(48).fontSize(16)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontColor($r('app.color.ink')).placeholderColor($r('app.color.muted_soft'))
          .backgroundColor($r('app.color.canvas'))
          .border({ width: this.originFocused ? 2 : 1,
            color: this.originFocused ? $r('app.color.primary') : $r('app.color.hairline') })
          .borderRadius(8)
          .onFocus(() => this.originFocused = true)
          .onBlur(() => this.originFocused = false)
          .onChange((value: string) => { this.origin = value; this.errorMessage = ''; })
        Row({ space: 8 }) {
          Checkbox().select(this.localHttp).selectedColor($r('app.color.primary'))
            .onChange((value: boolean) => this.localHttp = value)
          Text('允许本地/局域网 HTTP 测试（密码未经加密传输）')
            .onClick(() => this.localHttp = !this.localHttp)
            .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(12).fontColor($r('app.color.muted')).layoutWeight(1)
        }.width('100%').margin({ bottom: 8 })
        Text('访问密码').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.muted')).width('100%')
        TextInput({ text: this.password, placeholder: '输入访问密码' })
          .id('login_password_input')
          .tabIndex(2)
          .accessibilityText('访问密码')
          .type(InputType.Password).monopolizeEvents(true).height(48).fontSize(16)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontColor($r('app.color.ink')).placeholderColor($r('app.color.muted_soft'))
          .backgroundColor($r('app.color.canvas'))
          .border({
            width: this.passwordFocused ? 2 : 1,
            color: this.errorMessage ? $r('app.color.error') :
              (this.passwordFocused ? $r('app.color.primary') : $r('app.color.hairline'))
          })
          .borderRadius(8)
          .onFocus(() => this.passwordFocused = true)
          .onBlur(() => this.passwordFocused = false)
          .onChange((value: string) => {
            this.password = value;
            if (this.errorMessage) this.errorMessage = '';
          })
          .onSubmit(() => this.submit())
        Text(this.errorMessage).constraintSize({ minHeight: 16, maxHeight: 48 })
          .fontSize(13).fontColor($r('app.color.error')).width('100%')
        Button({ type: ButtonType.Normal }) {
          if (this.submitting || !this.ready) {
            LoadingProgress().width(20).height(20).color($r('app.color.on_primary'))
          } else {
            Text('连接').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(15)
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.on_primary'))
          }
        }
        .id('login_submit_button')
        .tabIndex(3)
        .focusable(true)
        .accessibilityText(!this.ready ? '正在恢复连接' : this.submitting ? '正在连接' : '连接')
        .width('100%').height(48).borderRadius(8).clip(true)
        .backgroundColor($r('app.color.primary'))
        .opacity(this.submitting || !this.ready || !this.password || !this.origin ? 0.58 : 1)
        .enabled(!this.submitting && this.ready && this.password.length > 0 && this.origin.length > 0)
        .onClick(() => this.submit())
      }.width('100%')
    }
    .width(wide ? 400 : '100%')
    .padding(wide ? 0 : { left: 24, right: 24, top: 28, bottom: 72 })
    .backgroundColor($r('app.color.canvas'))
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.viewportWidth >= 720) {
        Row() {
          Stack() {
            this.textureBackground()
            this.identityContent(true)
          }
          .layoutWeight(11)
          .height('100%')
          .clip(true)
          .backgroundColor($r('app.color.surface_soft'))
            .border({ width: { right: 1 }, color: $r('app.color.hairline') })
          Column() {
            this.accessContent(true)
          }
          .layoutWeight(9)
          .height('100%')
          .justifyContent(FlexAlign.Center)
            .alignItems(HorizontalAlign.Center).padding({ left: 36, right: 36 })
            .backgroundColor($r('app.color.canvas'))
        }
        .width('100%')
        .height('100%')
      } else {
        Stack() { this.textureBackground() }
          .width('100%')
          .height('50%')
          .constraintSize({ minHeight: 320, maxHeight: 400 })
          .clip(true)
          .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP])
        Scroll() {
          Column() {
            Stack() { this.identityContent(false) }
              .width('100%').height('34%').constraintSize({ minHeight: 260, maxHeight: 320 })
            this.accessContent(false)
          }.width('100%').constraintSize({ minHeight: '100%' })
        }.id('login_scroll').width('100%').height('100%').scrollBar(BarState.Off)
      }

      Stack({ alignContent: Alignment.Bottom }) {
        if (this.viewportWidth >= 720) {
          Row() {
            Blank().layoutWeight(11)
            Text('© 2026 学习日志工作台开源版')
              .layoutWeight(9)
              .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
              .fontSize(11)
              .fontWeight(FontWeight.Regular)
              .fontColor($r('app.color.muted_soft'))
              .textAlign(TextAlign.Center)
          }
          .width('100%')
          .margin({ bottom: 4 })
        } else {
          Text('© 2026 学习日志工作台开源版')
            .width('100%')
            .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(11)
            .fontWeight(FontWeight.Regular)
            .fontColor($r('app.color.muted_soft'))
            .textAlign(TextAlign.Center)
            .margin({ bottom: 16 })
        }
      }
      .width('100%')
      .height('100%')
      .hitTestBehavior(HitTestMode.None)
      .visibility(this.softwareKeyboardVisible ? Visibility.None : Visibility.Visible)

    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.canvas'))
    .onAreaChange((oldArea: Area, newArea: Area) => {
      const oldWidth = Number(oldArea.width);
      const width = Number(newArea.width);
      this.viewportWidth = width;
      if (oldWidth > 0 && (oldWidth >= 720) !== (width >= 720)) {
        this.textureAnimationStarted = false;
        this.textureOffset = 0;
      }
      if (width > 0 && !this.textureAnimationStarted) {
        setTimeout(() => this.startTextureAnimation(), 0);
      }
    })
    .onAppear(() => {
      this.previousKeyboardAvoidMode = this.getUIContext().getKeyboardAvoidMode();
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      this.getUIContext().getFont().registerFont({
        familyName: 'StudyLogSerif',
        familySrc: 'file:///system/fonts/NotoSerifCJK-Regular.ttc'
      });
    })
    .onDisAppear(() => {
      if (this.previousKeyboardAvoidMode !== undefined) {
        this.getUIContext().setKeyboardAvoidMode(this.previousKeyboardAvoidMode);
        this.previousKeyboardAvoidMode = undefined;
      }
    })
  }
}

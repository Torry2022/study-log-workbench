import { window } from '@kit.ArkUI';
import { KeyCode } from '@kit.InputKit';
import { workspaceKey } from '../../common/ui/WorkspaceKeys';
import { DesktopMenuEntry, DesktopWindow } from '../DesktopMenu';
import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { iconTint } from '../../common/ui/IconTint';
import { AppLogo } from '../../common/ui/AppLogo';

@Component
struct DesktopMenuRow {
  entry: DesktopMenuEntry = new DesktopMenuEntry('', '');
  showStatus: boolean = false;
  @State private hovered: boolean = false;

  build() {
    Row({ space: 12 }) {
      if (this.showStatus) {
        Image($r('app.media.check')).width(16).height(16).opacity(this.entry.checked ? 1 : 0)
          .colorFilter(iconTint($r('app.color.ink')))
      }
      Text(this.entry.label).layoutWeight(1).fontSize(14).fontColor($r('app.color.ink')).maxLines(1)
      if (this.entry.shortcut) {
        Text(this.entry.shortcut).fontSize(12).fontColor($r('app.color.muted'))
      }
    }.width('100%').height(40).padding({ left: 12, right: 12 }).borderRadius(4)
      .attributeModifier(new InteractiveSurface(Color.Transparent, this.entry.enabled && this.hovered))
      .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hovered = this.entry.enabled && hover))
  }
}

@Component
export struct DesktopTitleBar {
  @Prop @Watch('focusRequested') focusRevision: number = 0;
  onOpenChange: (open: boolean) => void = () => {};
  getEntries: (menu: string) => DesktopMenuEntry[] = () => [];
  onAction: (id: string) => void = () => {};
  @State private entries: DesktopMenuEntry[] = [];
  @State @Watch('openedChanged') private opened: string = '';
  @State private displayedMenu: string = '';
  @State private menuOffsets: number[] = [0, 0, 0, 0];
  @State private hovered: string = '';
  @State private buttonsWidth: number = 160;
  @State private barWidth: number = 1000;
  @State private menusWidth: number = 240;
  private mainWindow?: window.Window;
  private menuNames: string[] = ['文件', '编辑', '视图', '帮助'];

  private openedChanged(): void { this.onOpenChange(this.opened.length > 0); }

  private focusRequested(): void {
    if (this.focusRevision > 0) focusControl.requestFocus('window_menu_文件');
  }

  private selectMenu(name: string): void {
    this.entries = this.getEntries(name);
    this.displayedMenu = name;
    this.opened = name;
  }

  private openMenu(name: string, last: boolean = false): void {
    this.selectMenu(name);
    const enabled = this.entries.filter((entry: DesktopMenuEntry) => entry.enabled);
    if (enabled.length) {
      const id = enabled[last ? enabled.length - 1 : 0].id;
      setTimeout(() => focusControl.requestFocus(`window_action_${id}`), 20);
    }
  }

  private menuKey(event: KeyEvent, name: string, action: string = ''): boolean {
    if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE) || workspaceKey(event, KeyCode.KEYCODE_F10)) {
      this.opened = '';
      focusControl.requestFocus(`window_menu_${name}`);
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_LEFT) || workspaceKey(event, KeyCode.KEYCODE_DPAD_RIGHT)) {
      const offset = event.keyCode === KeyCode.KEYCODE_DPAD_LEFT ? -1 : 1;
      const next = this.menuNames[(this.menuNames.indexOf(name) + offset + this.menuNames.length) % this.menuNames.length];
      if (this.opened) this.openMenu(next);
      else focusControl.requestFocus(`window_menu_${next}`);
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_UP) || workspaceKey(event, KeyCode.KEYCODE_DPAD_DOWN)) {
      const up = event.keyCode === KeyCode.KEYCODE_DPAD_UP;
      if (!action) this.openMenu(name, up);
      else {
        const enabled = this.entries.filter((entry: DesktopMenuEntry) => entry.enabled);
        const index = enabled.findIndex((entry: DesktopMenuEntry) => entry.id === action);
        const next = enabled[(index + (up ? -1 : 1) + enabled.length) % enabled.length];
        if (next) focusControl.requestFocus(`window_action_${next.id}`);
      }
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_ENTER)) {
      if (action) { this.opened = ''; this.onAction(action); }
      else this.openMenu(name);
      return true;
    }
    return false;
  }
  private rectChanged = (rect: window.TitleButtonRect): void => {
    this.buttonsWidth = rect.width + rect.right;
  };

  aboutToAppear(): void {
    this.mainWindow = DesktopWindow.mainWindow;
    if (!this.mainWindow) return;
    this.rectChanged(this.mainWindow.getTitleButtonRect());
    this.mainWindow.on('windowTitleButtonRectChange', this.rectChanged);
  }

  aboutToDisappear(): void {
    this.mainWindow?.off('windowTitleButtonRectChange', this.rectChanged);
  }

  private move(event: TouchEvent): void {
    if (event.type === TouchType.Down) {
      this.mainWindow?.startMoving().catch(() => {});
    }
  }

  private async toggleMaximize(): Promise<void> {
    if (!this.mainWindow) return;
    try {
      const status = this.mainWindow.getWindowStatus();
      if (status === window.WindowStatusType.MAXIMIZE || status === window.WindowStatusType.FULL_SCREEN) {
        await this.mainWindow.recover();
      } else await this.mainWindow.maximize(window.MaximizePresentation.EXIT_IMMERSIVE);
    } catch (_) { /* The window can change state while a gesture is in progress. */ }
  }

  @Builder
  private menu() {
    Column() {
      ForEach(this.entries, (entry: DesktopMenuEntry, index: number) => {
        if (index > 0 && ['share-current', 'backup', 'returnShared', 'settings', 'preview', 'theme_light'].includes(entry.id)) {
          Divider().color($r('app.color.hairline')).margin({ top: 4, bottom: 4, left: 12, right: 12 })
        }
        if (this.displayedMenu === '视图' && ['sidebar', 'preview', 'theme_light'].includes(entry.id)) {
          Text(entry.id === 'sidebar' ? '工作区' : entry.id === 'preview' ? '日志显示' : '主题')
            .fontSize(12).fontColor($r('app.color.muted')).width('100%')
            .padding({ left: 40, right: 12, top: 4, bottom: 4 })
        }
        Button({ type: ButtonType.Normal, stateEffect: false }) {
          DesktopMenuRow({ entry: entry, showStatus: this.displayedMenu === '视图' })
        }.width('100%').padding(0).backgroundColor(Color.Transparent).borderRadius(4)
          .id(`window_action_${entry.id}`).accessibilityText(entry.label)
          .enabled(entry.enabled)
          .onKeyEvent((event: KeyEvent) => this.menuKey(event, this.opened, entry.id))
          .onClick(() => { this.opened = ''; this.onAction(entry.id); })
      }, (entry: DesktopMenuEntry) => entry.id)
    }.width(264).padding(8).backgroundColor($r('app.color.canvas')).borderRadius(8)
  }

  build() {
    Row({ space: 4 }) {
      Row({ space: 8 }) {
        AppLogo({ iconSize: 24, cornerRadius: 4 })
        if (this.barWidth - this.buttonsWidth - this.menusWidth >= 160) {
          Text('学习日志').fontSize(14).fontColor($r('app.color.ink')).maxLines(1)
        }
      }.height('100%').margin({ right: 12 }).flexShrink(0)
          .onTouch((event: TouchEvent) => this.move(event))
          .gesture(TapGesture({ count: 2 }).onAction(() => this.toggleMaximize()))
      Row({ space: 4 }) {
      ForEach(this.menuNames, (name: string, index: number) => {
        Button(name, { type: ButtonType.Normal, stateEffect: false })
          .id(`window_menu_${name}`).height(32).padding({ left: 12, right: 12 })
          .fontSize(14).fontColor($r('app.color.ink')).borderRadius(4)
          .onAreaChange((_oldArea, area) => this.menuOffsets[index] = Number(area.position.x))
          .onKeyEvent((event: KeyEvent) => this.menuKey(event, name))
          .attributeModifier(new InteractiveSurface(this.opened === name ? $r('app.color.surface_card') :
            Color.Transparent, this.hovered === name, this.opened === name))
          .onHover((hover: boolean) => {
            animateHover(this.getUIContext(), () => this.hovered = hover ? name : '');
            if (hover && this.opened && this.opened !== name) {
              this.selectMenu(name);
            }
          })
          .onClick(() => {
            if (this.opened === name) this.opened = '';
            else this.selectMenu(name);
          })
      })
      }.flexShrink(0).onAreaChange((_oldArea, area) => this.menusWidth = Number(area.width))
          // One persistent popup: menu switches update content/anchor, not visibility.
          .bindPopup(this.opened.length > 0, {
            builder: this.menu(),
            placement: Placement.BottomLeft,
            offset: { x: this.menuOffsets[this.menuNames.indexOf(this.displayedMenu)] || 0, y: 0 },
            enableArrow: false,
            mask: false,
            focusable: true,
            targetSpace: 4,
            popupColor: $r('app.color.canvas'),
            backgroundBlurStyle: BlurStyle.NONE,
            radius: 8,
            transition: TransitionEffect.OPACITY.animation({ duration: 100, curve: Curve.EaseOut }),
            onStateChange: (event) => { if (!event.isVisible) this.opened = ''; }
          })
      Row().layoutWeight(1).height('100%').onTouch((event: TouchEvent) => this.move(event))
        .id('window_title_drag_area')
        .gesture(TapGesture({ count: 2 }).onAction(() => this.toggleMaximize()))
    }.width('100%').height(40).padding({ left: 12, right: this.buttonsWidth + 8 })
      .onAreaChange((_oldArea, area) => this.barWidth = Number(area.width))
      .backgroundColor($r('app.color.surface_soft'))
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }
}

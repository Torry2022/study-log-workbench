import { Configuration, ConfigurationConstant, UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { DesktopWindow } from '../app/DesktopMenu';

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private keyboardHeightChanged = (height: number): void => {
    AppStorage.setOrCreate('softwareKeyboardVisible', height > 0);
  };
  private bottomAvoidAreaChanged = (): void => {
    if (!this.mainWindow) return;
    const system = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const navigation = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    AppStorage.setOrCreate('windowBottomAvoidPx', Math.max(system.bottomRect.height, navigation.bottomRect.height));
  };

  onCreate(): void {
    this.publishSystemTheme(this.context.config.colorMode);
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
  }

  onConfigurationUpdate(configuration: Configuration): void {
    this.publishSystemTheme(configuration.colorMode);
    this.updateSystemBars(configuration.colorMode);
  }

  private publishSystemTheme(mode?: ConfigurationConstant.ColorMode): void {
    AppStorage.setOrCreate('systemTheme', mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK ? 'dark' : 'light');
  }

  private updateSystemBars(mode?: ConfigurationConstant.ColorMode): void {
    if (!this.mainWindow) return;
    const dark = mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    const content = dark ? '#F5F0E8' : '#141413';
    try {
      this.mainWindow.setWindowSystemBarProperties({
        statusBarColor: '#00000000', statusBarContentColor: content,
        navigationBarColor: '#00000000', navigationBarContentColor: content,
        isStatusBarLightIcon: dark, isNavigationBarLightIcon: dark
      });
    } catch (_) { /* The window may be closing during a theme change. */ }
  }

  onWindowStageCreate(stage: window.WindowStage): void {
    this.mainWindow = stage.getMainWindowSync();
    AppStorage.setOrCreate('softwareKeyboardVisible', false);
    this.mainWindow.on('keyboardHeightChange', this.keyboardHeightChanged);
    this.mainWindow.on('avoidAreaChange', this.bottomAvoidAreaChanged);
    this.updateSystemBars(this.context.config.colorMode);
    stage.loadContent('pages/Index', (error) => {
      if (!error.code) this.bottomAvoidAreaChanged();
      if (error.code || deviceInfo.deviceType !== '2in1' || !this.mainWindow) return;
      try {
        this.mainWindow.setWindowDecorHeight(40);
        this.mainWindow.setWindowTitleMoveEnabled(false);
        this.mainWindow.setWindowDecorVisible(false);
        DesktopWindow.mainWindow = this.mainWindow;
        AppStorage.setOrCreate<boolean>('desktopWindowChrome', true);
      } catch (_) {
        this.mainWindow.setWindowDecorVisible(true);
        this.mainWindow.setWindowTitleMoveEnabled(true);
      }
    });
  }

  onWindowStageDestroy(): void {
    this.mainWindow?.off('keyboardHeightChange', this.keyboardHeightChanged);
    this.mainWindow?.off('avoidAreaChange', this.bottomAvoidAreaChanged);
    AppStorage.setOrCreate('windowBottomAvoidPx', 0);
    AppStorage.setOrCreate('softwareKeyboardVisible', false);
    this.mainWindow = undefined;
    DesktopWindow.mainWindow = undefined;
  }
}

import { Configuration, ConfigurationConstant, UIAbility } from '@kit.AbilityKit';
import { ColorMetrics, window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { preferences } from '@kit.ArkData';
import { DesktopWindow } from '../app/DesktopMenu';
import { THEME_PREFERENCES } from '../common/AppConfig';

// Temporary device-acceptance setting; turn off before a public release.
const KEEP_SCREEN_ON_DURING_ACCEPTANCE = false;

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private initialThemeReady: Promise<void> = Promise.resolve();
  private updateStartWindowBackground(mode?: ConfigurationConstant.ColorMode): void {
    // Keep these values aligned with the base/dark start_window_background resources.
    const color = mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK ? 0xFF151412 : 0xFFFAF9F5;
    try {
      window.setStartWindowBackgroundColor('entry', 'EntryAbility', ColorMetrics.numeric(color)).catch(() => {});
    } catch (_) { /* The static start window resource remains available. */ }
  }

  private async initializeTheme(): Promise<void> {
    let value = 'system';
    try {
      const store = await preferences.getPreferences(this.context, { name: THEME_PREFERENCES });
      const saved = await store.get('theme', 'system') as string;
      if (saved === 'light' || saved === 'dark') value = saved;
    } catch (_) { /* Keep the system theme when local settings are unavailable. */ }
    AppStorage.setOrCreate('themePreference', value);
    const mode = value === 'light' ? ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT :
      value === 'dark' ? ConfigurationConstant.ColorMode.COLOR_MODE_DARK :
        ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
    this.updateStartWindowBackground(mode === ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET ?
      this.context.config.colorMode : mode);
    try { this.context.getApplicationContext().setColorMode(mode); }
    catch (_) { /* Keep the current system mode if the window is closing. */ }
  }
  private keyboardHeightChanged = (height: number): void => {
    AppStorage.setOrCreate('softwareKeyboardVisible', height > 0);
    AppStorage.setOrCreate('softwareKeyboardHeightPx', Math.max(0, height));
  };
  private bottomAvoidAreaChanged = (): void => {
    if (!this.mainWindow) return;
    const system = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const navigation = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    AppStorage.setOrCreate('windowBottomAvoidPx', Math.max(system.bottomRect.height, navigation.bottomRect.height));
  };

  onCreate(): void {
    this.publishSystemTheme(this.context.config.colorMode);
    this.initialThemeReady = this.initializeTheme();
  }

  onConfigurationUpdate(configuration: Configuration): void {
    this.publishSystemTheme(configuration.colorMode);
    this.updateSystemBars(configuration.colorMode);
    this.updateStartWindowBackground(configuration.colorMode);
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
    if (KEEP_SCREEN_ON_DURING_ACCEPTANCE) this.mainWindow.setWindowKeepScreenOn(true);
    AppStorage.setOrCreate('softwareKeyboardVisible', false);
    AppStorage.setOrCreate('softwareKeyboardHeightPx', 0);
    this.mainWindow.on('keyboardHeightChange', this.keyboardHeightChanged);
    this.mainWindow.on('avoidAreaChange', this.bottomAvoidAreaChanged);
    this.updateSystemBars(this.context.config.colorMode);
    this.initialThemeReady.then(() => stage.loadContent('pages/Index', (error) => {
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
    }));
  }

  onWindowStageDestroy(): void {
    this.mainWindow?.off('keyboardHeightChange', this.keyboardHeightChanged);
    this.mainWindow?.off('avoidAreaChange', this.bottomAvoidAreaChanged);
    AppStorage.setOrCreate('windowBottomAvoidPx', 0);
    AppStorage.setOrCreate('softwareKeyboardVisible', false);
    AppStorage.setOrCreate('softwareKeyboardHeightPx', 0);
    this.mainWindow = undefined;
    DesktopWindow.mainWindow = undefined;
  }
}

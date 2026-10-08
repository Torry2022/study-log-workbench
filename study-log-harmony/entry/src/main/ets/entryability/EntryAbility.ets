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
  private contentReady: boolean = false;
  private keyboardObserved: boolean = false;
  private avoidAreaObserved: boolean = false;
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
    try {
      const system = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const navigation = this.mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
      AppStorage.setOrCreate('windowBottomAvoidPx', Math.max(system.bottomRect.height, navigation.bottomRect.height));
    } catch (_) { /* An already queued event may arrive while the window is closing. */ }
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
    this.contentReady = false;
    const createdWindow = this.mainWindow;
    this.updateSystemBars(this.context.config.colorMode);
    this.initialThemeReady.then(() => {
      if (this.mainWindow !== createdWindow) return;
      stage.loadContent('pages/Index', (error) => {
        if (this.mainWindow !== createdWindow || error.code) return;
        this.contentReady = true;
        this.observeWindow();
        if (deviceInfo.deviceType !== '2in1') return;
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
    });
  }

  private observeWindow(): void {
    if (!this.mainWindow || !this.contentReady) return;
    // Listener registration needs a loaded window; retry a failed registration on foreground.
    if (!this.keyboardObserved) {
      try {
        this.mainWindow.on('keyboardHeightChange', this.keyboardHeightChanged);
        this.keyboardObserved = true;
      } catch (_) { console.warn('Keyboard observer is waiting for the main window.'); }
    }
    if (!this.avoidAreaObserved) {
      try {
        this.mainWindow.on('avoidAreaChange', this.bottomAvoidAreaChanged);
        this.avoidAreaObserved = true;
      } catch (_) { console.warn('Avoid-area observer is waiting for the main window.'); }
    }
    this.bottomAvoidAreaChanged();
  }

  onForeground(): void {
    this.observeWindow();
  }

  onWindowStageDestroy(): void {
    const closingWindow = this.mainWindow;
    this.mainWindow = undefined;
    this.contentReady = false;
    try {
      if (this.keyboardObserved) closingWindow?.off('keyboardHeightChange', this.keyboardHeightChanged);
    } catch (_) { /* The system may already have destroyed the window. */ }
    try {
      if (this.avoidAreaObserved) closingWindow?.off('avoidAreaChange', this.bottomAvoidAreaChanged);
    } catch (_) { /* Release the remaining state even when the window is gone. */ }
    this.keyboardObserved = false;
    this.avoidAreaObserved = false;
    AppStorage.setOrCreate('windowBottomAvoidPx', 0);
    AppStorage.setOrCreate('softwareKeyboardVisible', false);
    AppStorage.setOrCreate('softwareKeyboardHeightPx', 0);
    DesktopWindow.mainWindow = undefined;
  }
}

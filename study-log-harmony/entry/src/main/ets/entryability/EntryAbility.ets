import { Configuration, ConfigurationConstant, UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onCreate(): void {
    this.publishSystemTheme(this.context.config.colorMode);
    this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
  }

  onConfigurationUpdate(configuration: Configuration): void {
    this.publishSystemTheme(configuration.colorMode);
  }

  private publishSystemTheme(mode?: ConfigurationConstant.ColorMode): void {
    AppStorage.setOrCreate('systemTheme', mode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK ? 'dark' : 'light');
  }

  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/Index');
  }
}

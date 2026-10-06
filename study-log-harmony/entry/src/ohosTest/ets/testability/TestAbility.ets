import { UIAbility } from '@kit.AbilityKit';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { window } from '@kit.ArkUI';
import { Hypium } from '@ohos/hypium';
import loginKeyboardGeometryTest from '../test/LoginKeyboardGeometry.test';

export default class TestAbility extends UIAbility {
  onWindowStageCreate(_stage: window.WindowStage): void {
    Hypium.hypiumTest(abilityDelegatorRegistry.getAbilityDelegator(),
      abilityDelegatorRegistry.getArguments(), loginKeyboardGeometryTest);
  }
}

import { abilityDelegatorRegistry, TestRunner } from '@kit.TestKit';
import { Hypium } from '@ohos/hypium';
import loginKeyboardGeometryTest from '../test/LoginKeyboardGeometry.test';

export default class OpenHarmonyTestRunner implements TestRunner {
  onPrepare(): void {}

  async onRun(): Promise<void> {
    const delegator = abilityDelegatorRegistry.getAbilityDelegator();
    const args = abilityDelegatorRegistry.getArguments();
    // Run only against an authorized, logged-out synthetic installation. No token/data reset.
    await delegator.startAbility({ bundleName: args.bundleName, abilityName: 'EntryAbility' });
    Hypium.hypiumTest(delegator, args, loginKeyboardGeometryTest);
  }
}

import { abilityDelegatorRegistry, TestRunner } from '@kit.TestKit';

export default class OpenHarmonyTestRunner implements TestRunner {
  onPrepare(): void {}

  async onRun(): Promise<void> {
    const delegator = abilityDelegatorRegistry.getAbilityDelegator();
    const args = abilityDelegatorRegistry.getArguments();
    await delegator.startAbility({ bundleName: args.bundleName, moduleName: args.parameters['-m'],
      abilityName: 'TestAbility' });
  }
}

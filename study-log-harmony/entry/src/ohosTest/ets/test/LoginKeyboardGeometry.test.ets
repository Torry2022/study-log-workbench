import { abilityDelegatorRegistry, Driver, ON, WindowMode } from '@kit.TestKit';
import { KeyboardAvoidMode, UIContext, window } from '@kit.ArkUI';
import { describe, expect, it } from '@ohos/hypium';

async function reveal(driver: Driver, context: UIContext, id: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const bounds = await (await driver.findComponent(ON.id('login_scroll'))).getBounds();
    const target = context.getComponentUtils().getRectangleById(id);
    if (target.windowOffset.y >= bounds.top && target.windowOffset.y + target.size.height <= bounds.bottom) return;
    // Keep gestures in the current viewport and outside the form's text inputs.
    await driver.swipe(bounds.right - 24, bounds.bottom - 80, bounds.right - 24, bounds.top + 80, 600);
    await driver.delayMs(500);
  }
  throw new Error(`Login control is not reachable: ${id}`);
}

export default function loginKeyboardGeometryTest(): void {
  describe('LoginKeyboardGeometry', () => {
    it('restoresNarrowLoginAfterEnteringTheWideLayout', 0, async () => {
      const driver = Driver.create();
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      await delegator.startAbility({ bundleName: abilityDelegatorRegistry.getArguments().bundleName,
        abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('login_origin_input'), 10000);
      await driver.delayMs(1000);
      const ability = await abilityDelegatorRegistry.getAbilityDelegator().getCurrentTopAbility();
      const main = await window.getLastWindow(ability.context);
      const context = main.getUIContext();
      const geometry = context.getComponentUtils();
      const appWindow = await driver.findWindow({ bundleName: abilityDelegatorRegistry.getArguments().bundleName });
      const mode = await appWindow.getWindowMode();
      const original = main.getWindowProperties().windowRect;
      try {
        if (mode === WindowMode.FULLSCREEN) await appWindow.resume();
        await main.resize(Math.round(context.vp2px(480)), Math.round(context.vp2px(800)));
        await driver.delayMs(1500);
        expect(!!await driver.findComponent(ON.id('login_scroll'))).assertTrue();
        const initial = geometry.getRectangleById('login_app_icon');
        await main.resize(Math.round(context.vp2px(900)), Math.round(context.vp2px(800)));
        await driver.delayMs(1500);
        expect(context.px2vp(main.getWindowProperties().windowRect.width) >= 720).assertTrue();
        expect(!!await driver.findComponent(ON.id('login_scroll'))).assertFalse();
        expect(geometry.getRectangleById('login_identity_statement').size.height > 0).assertTrue();
        expect(!!await driver.findComponent(ON.id('login_origin_input'))).assertTrue();
        expect(geometry.getRectangleById('login_submit_button').size.height > 0).assertTrue();
        await main.resize(Math.round(context.vp2px(480)), Math.round(context.vp2px(800)));
        await driver.delayMs(1500);
        expect(!!await driver.findComponent(ON.id('login_scroll'))).assertTrue();
        expect(Math.abs(geometry.getRectangleById('login_app_icon').windowOffset.y - initial.windowOffset.y) < 2).assertTrue();
      } finally {
        await main.resize(original.width, original.height);
        if (mode === WindowMode.FULLSCREEN) await appWindow.maximize();
        await driver.delayMs(1500);
      }
    });
    it('keepsPublicConnectionFormInOneTopExtendedViewport', 0, async () => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: abilityDelegatorRegistry.getArguments().bundleName,
        abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('login_origin_input'), 10000);
      await driver.delayMs(1000);
      const ability = await delegator.getCurrentTopAbility();
      const main = await window.getLastWindow(ability.context);
      const context = main.getUIContext();
      const geometry = context.getComponentUtils();
      const initialTitle = geometry.getRectangleById('login_identity_statement');
      const initialIcon = geometry.getRectangleById('login_app_icon');
      const scroll = await driver.findComponent(ON.id('login_scroll'));
      // This is a narrow-layout suite: a wide window must be resized before running it.
      expect(!!scroll).assertTrue();
      expect(initialIcon.windowOffset.y >= main.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height).assertTrue();
      const initialOrigin = await (await driver.findComponent(ON.id('login_origin_input'))).getText();
      const initialPassword = await (await driver.findComponent(ON.id('login_password_input'))).getText();
      expect(initialPassword.length).assertEqual(0);
      try {
        for (const inputId of ['login_origin_input', 'login_password_input', 'login_origin_input', 'login_password_input']) {
          await reveal(driver, context, inputId);
          const input = await driver.findComponent(ON.id(inputId));
          expect(!!input).assertTrue();
          await input.click();
          await driver.delayMs(1000);
          expect(AppStorage.get<boolean>('softwareKeyboardVisible')).assertTrue();
          expect(context.getKeyboardAvoidMode()).assertEqual(KeyboardAvoidMode.RESIZE);
          const viewport = geometry.getRectangleById('login_scroll');
          const title = geometry.getRectangleById('login_identity_statement');
          const field = geometry.getRectangleById(inputId);
          const hitBounds = await scroll.getBounds();
          await delegator.print(`PublicLoginGeometry ${inputId} viewport=${JSON.stringify(viewport)} title=${JSON.stringify(title)} field=${JSON.stringify(field)} hitBounds=${JSON.stringify(hitBounds)}\n`);
          // Layout, UiTest hit bounds and actual pixels are separate evidence.
          expect(viewport.windowOffset.y).assertEqual(0);
          expect(title.size.height > 0 && Math.abs(title.size.height - initialTitle.size.height) < 1).assertTrue();
          expect(field.windowOffset.y + field.size.height <= hitBounds.bottom + 1).assertTrue();
          await reveal(driver, context, 'login_submit_button');
          const submit = await driver.findComponent(ON.id('login_submit_button'));
          expect(!!submit).assertTrue();
          const submitBounds = await submit.getBounds();
          expect(submitBounds.bottom <= (await scroll.getBounds()).bottom + 1).assertTrue();
          expect(submitBounds.bottom > submitBounds.top).assertTrue();
          await scroll.scrollToTop();
          await driver.delayMs(400);
          const atTop = geometry.getRectangleById('login_app_icon');
          expect(atTop.windowOffset.y >= main.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height).assertTrue();
          const scrollHit = await scroll.getBounds();
          const x = scrollHit.right - 24;
          await driver.swipe(x, scrollHit.bottom - 80, x, scrollHit.top + 80, 600);
          const scrolledIcon = geometry.getRectangleById('login_app_icon');
          expect(scrolledIcon.windowOffset.y < main.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height).assertTrue();
          await delegator.print(`PublicLoginScrolled ${inputId} icon=${JSON.stringify(scrolledIcon)}\n`);
          await driver.pressBack();
          await driver.delayMs(700);
          expect(AppStorage.get<boolean>('softwareKeyboardVisible')).assertFalse();
          await scroll.scrollToTop();
          const restored = geometry.getRectangleById('login_app_icon');
          expect(Math.abs(restored.windowOffset.y - initialIcon.windowOffset.y) < 2).assertTrue();
        }
        // Re-create the real page without resetting instance preferences or tokens.
        await main.loadContent('pages/Index');
        await driver.waitForComponent(ON.id('login_origin_input'), 10000);
        await driver.delayMs(1000);
        const reopenedIcon = main.getUIContext().getComponentUtils().getRectangleById('login_app_icon');
        expect(Math.abs(reopenedIcon.windowOffset.y - initialIcon.windowOffset.y) < 2).assertTrue();
      } catch (error) {
        await delegator.print(`PublicLoginFailure ${String(error)}\n`);
        throw new Error(String(error));
      } finally {
        if (AppStorage.get<boolean>('softwareKeyboardVisible')) await driver.pressBack();
        // Reload the saved connection form, including after a failed test gesture.
        await main.loadContent('pages/Index');
        await driver.waitForComponent(ON.id('login_origin_input'), 10000);
        await driver.delayMs(700);
        await (await driver.findComponent(ON.id('login_scroll'))).scrollToTop();
        expect(await (await driver.findComponent(ON.id('login_origin_input'))).getText()).assertEqual(initialOrigin);
        expect(await (await driver.findComponent(ON.id('login_password_input'))).getText()).assertEqual(initialPassword);
      }
    });
  });
}

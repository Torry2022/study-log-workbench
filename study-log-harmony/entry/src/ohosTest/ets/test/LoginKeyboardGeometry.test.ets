import { abilityDelegatorRegistry, Driver, ON } from '@kit.TestKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';
import { describe, expect, it } from '@ohos/hypium';

export default function loginKeyboardGeometryTest(): void {
  describe('LoginKeyboardGeometry', () => {
    it('keepsPublicConnectionFormInOneTopExtendedViewport', 0, async () => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
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
          const input = await scroll.scrollSearch(ON.id(inputId));
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
          const submit = await scroll.scrollSearch(ON.id('login_submit_button'));
          expect(!!submit).assertTrue();
          const submitBounds = await submit.getBounds();
          expect(submitBounds.bottom <= (await scroll.getBounds()).bottom + 1).assertTrue();
          expect(submitBounds.bottom > submitBounds.top).assertTrue();
          await scroll.scrollToTop();
          await driver.delayMs(400);
          const atTop = geometry.getRectangleById('login_app_icon');
          expect(atTop.windowOffset.y >= main.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).topRect.height).assertTrue();
          const scrollHit = await scroll.getBounds();
          const x = Math.round((scrollHit.left + scrollHit.right) / 2);
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
        const reopenedIcon = geometry.getRectangleById('login_app_icon');
        expect(Math.abs(reopenedIcon.windowOffset.y - initialIcon.windowOffset.y) < 2).assertTrue();
      } finally {
        if (AppStorage.get<boolean>('softwareKeyboardVisible')) await driver.pressBack();
        await (await driver.findComponent(ON.id('login_scroll'))).scrollToTop();
        expect(await (await driver.findComponent(ON.id('login_origin_input'))).getText()).assertEqual(initialOrigin);
        expect(await (await driver.findComponent(ON.id('login_password_input'))).getText()).assertEqual(initialPassword);
      }
    });
  });
}

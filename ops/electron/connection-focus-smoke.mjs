import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron, expect } = require('@playwright/test');
const er = createRequire(new URL('./package.json', import.meta.url));
const output = path.resolve('.local', `connection-focus-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'connection-focus-'));
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: er('electron'), args: [path.resolve('ops/electron')], env });
try {
  const page = await app.firstWindow();
  await expect(page.getByLabel('保存位置')).not.toHaveValue('');
  await expect(page.locator('#directory-state')).toHaveText('将在此处保存学习记录');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const height of [520, 360]) {
      await app.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setContentSize(640, height), height);
      for (const mode of ['local', 'remote']) {
        await page.locator(`[value=${mode}]`).check();
        await page.keyboard.press('Tab');
        const input = mode === 'local' ? page.getByLabel('保存位置') : page.locator('[name=origin]');
        await input.focus();
        // At small heights the form scrolls; inspect the fully scrolled-into-view control.
        await input.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const geometry = await input.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const clip = document.querySelector('.fields').getBoundingClientRect();
          const style = getComputedStyle(element);
          const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
          return { visible: element.matches(':focus-visible'), extent, left: rect.left - clip.left, right: clip.right - rect.right, top: rect.top - clip.top, bottom: clip.bottom - rect.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(geometry.visible && geometry.extent > 0, JSON.stringify(geometry));
        for (const edge of ['left', 'right', 'top', 'bottom']) assert.ok(geometry[edge] >= geometry.extent, `${mode}/${theme}/${height}: ${edge} focus ring clipped`);
        assert.equal(geometry.overflow, false);
        await page.screenshot({ path: path.join(output, `${mode}-${theme}-${height}.png`) });
      }
    }
  }
  console.log(`Focus geometry passed; screenshots: ${output}`);
} finally {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close()));
  await closed;
}

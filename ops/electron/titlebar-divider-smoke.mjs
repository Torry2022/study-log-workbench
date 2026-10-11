import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron, expect } = require('@playwright/test');
const executablePath = process.argv[2];
if (!executablePath || !path.isAbsolute(executablePath)) throw Error('Explicit packaged EXE required');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-divider-test-'));
const output = path.resolve('.local', `titlebar-divider-${Date.now()}`); await fs.mkdir(output);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath, env, timeout: 60000 });
const results = [];
try {
  const page = await workspacePage(app);
  const bar = app.context().pages().find(page => page.url().includes('titlebar.html'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: '切换主题模式', exact: true }).click();
    await page.locator('.theme-popover').getByRole('button', { name: theme === 'dark' ? '夜间模式' : '日间模式', exact: true }).click();
    await expect(bar.locator('html')).toHaveAttribute('data-theme', theme);
    const geometry = await bar.evaluate(() => {
      const header = document.querySelector('header'), rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
      return { overlayHeight: rect.height, headerHeight: header.getBoundingClientRect().height,
        borderWidth: getComputedStyle(header).borderBottomWidth, borderColor: getComputedStyle(header).borderBottomColor };
    });
    assert.equal(geometry.headerHeight, 36); assert.equal(geometry.borderWidth, '1px');
    assert.ok(geometry.overlayHeight <= 35, JSON.stringify(geometry));
    const base64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1440, height: 900 } });
      return sources.find(source => source.id === window.getMediaSourceId())?.thumbnail.toPNG().toString('base64');
    });
    assert.ok(base64, 'Native window capture, including system buttons, required');
    const png = Buffer.from(base64, 'base64'); await fs.writeFile(path.join(output, `${theme}-window.png`), png);
    const { data, info } = await require('sharp')(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const target = geometry.borderColor.match(/\d+/g).slice(0, 3).map(Number);
    const distance = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
    const rows = Array.from({ length: 40 }, (_, i) => i + 20).filter(y => y < info.height);
    const x = Math.floor(info.width / 2);
    const y = rows.sort((a, b) => distance(pixel(x, a), target) - distance(pixel(x, b), target))[0];
    const left = pixel(x, y);
    assert.ok(distance(left, target) <= 12, `Divider color missing: ${left}/${target}`);
    for (const offset of [120, 80, 40, 20]) assert.ok(distance(pixel(info.width - offset, y), left) <= 3, `Divider interrupted below native controls at ${offset}px`);
    results.push({ theme, geometry, nativeDividerRow: y, pixel: left, size: [info.width, info.height] });
  }
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Packaged native titlebar divider light/dark checks passed: ${output}`);
} finally {
  const ended = app.waitForEvent('close', { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await ended;
}

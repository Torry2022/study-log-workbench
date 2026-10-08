import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { workspacePage } from './workspace-test.mjs';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const currentVersion = JSON.parse(await fs.readFile(new URL('./package.json', import.meta.url), 'utf8')).version;
const er = createRequire(new URL('./package.json', import.meta.url));
const { _electron: electron, expect } = require('@playwright/test');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-updates-'));
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: process.argv[2] || er('electron'), args: process.argv[2] ? [] : [path.resolve('ops/electron')], env });
const evidence = path.resolve('.local', `desktop-updates-${Date.now()}`); await fs.mkdir(evidence);
let remote;
try {
  const page = await workspacePage(app);
  await app.evaluate(({ dialog, shell }) => {
    globalThis.messages = []; globalThis.opened = []; globalThis.updateRequests = 0;
    dialog.showMessageBox = async (...args) => { globalThis.messages.push(args.at(-1)); return { response: 0 }; };
    shell.openExternal = async url => { globalThis.opened.push(url); };
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.github.com/repos/Torry2022/')) {
        globalThis.updateRequests++;
        if (globalThis.updateFailure) throw Error('synthetic offline');
        return { ok: true, json: async () => globalThis.releases };
      }
      return original(url, options);
    };
  });
  const click = label => app.evaluate(({ Menu }, label) => Menu.getApplicationMenu().items[3].submenu.items.find(i => i.label === label).click(), label);
  const message = async () => { await expect.poll(() => app.evaluate(() => globalThis.messages.length)).toBe(1); return app.evaluate(() => globalThis.messages.pop()); };
  await click('关于学习日志工作台');
  let value = await message(); assert.ok(value.detail.includes(`桌面版本：${currentVersion}`)); assert.ok(value.detail.includes(`本地服务版本：${currentVersion}`));
  await page.route('**/api/capabilities', route => route.fulfill({ json: { apiContractVersion: 1 } }));
  await click('关于学习日志工作台'); value = await message(); assert.match(value.detail, /未提供（旧版服务器）/); await page.unroute('**/api/capabilities');
  assert.equal(await app.evaluate(() => globalThis.updateRequests), 0, 'no automatic release requests');
  await app.evaluate(() => { globalThis.releases = [{ tag_name: 'v99.0.0-rc.5', prerelease: true, body: '# 合成版本说明\n\n## 本次更新\n- **合成改动**\n'.repeat(300), assets: [{ name: 'study-log-desktop-99.0.0-rc.5-x64-setup.exe' }] }]; });
  await click('检查更新…'); value = await message(); assert.match(value.message, /99\.0\.0-rc\.5/); assert.doesNotMatch(value.detail, /合成版本说明|##|\*\*/); assert.ok(value.detail.length < 160); assert.match(value.detail, /发布页/);
  await expect.poll(() => app.evaluate(() => globalThis.opened.length)).toBe(1);
  assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://github.com/Torry2022/study-log-workbench-public/releases/tag/v99.0.0-rc.5']);
  await app.evaluate(() => { globalThis.releases[0].tag_name = 'v0.0.1'; });
  await click('检查更新…'); value = await message(); assert.equal(value.message, '当前没有可用更新'); assert.doesNotMatch(value.detail, /实例|包含预发布/); assert.match(value.detail, /当前使用预发布版本/); assert.match(value.detail, /仅针对 Windows 桌面端/);
  await app.evaluate(() => { globalThis.updateFailure = true; });
  await click('检查更新…'); value = await message(); assert.equal(value.message, '暂时无法检查更新');
  await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('check-updates').enabled)).toBe(true);
  // A second isolated client connects to the first synthetic instance as a server.
  const remoteProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-updates-remote-'));
  remote = await electron.launch({ executablePath: process.argv[2] || er('electron'), args: process.argv[2] ? [] : [path.resolve('ops/electron')], env: { ...env, STUDY_LOG_DESKTOP_PROFILE: remoteProfile } });
  await expect.poll(() => remote.context().pages().some(p => p.url().includes('connection.html'))).toBe(true);
  const chooser = remote.context().pages().find(p => p.url().includes('connection.html'));
  const root = JSON.parse(await fs.readFile(path.join(profile, 'desktop.json'), 'utf8')).root;
  const password = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8')).APP_PASSWORD;
  await chooser.locator('input[value=remote]').check(); await chooser.locator('[name=origin]').fill(new URL(page.url()).origin);
  await chooser.locator('[name=password]').fill(password); await chooser.locator('[name=localHttp]').check();
  await chooser.getByRole('button', { name: '连接服务器', exact: true }).click();
  await expect.poll(() => chooser.isClosed(), { timeout: 15000 }).toBe(true);
  await workspacePage(remote);
  await remote.evaluate(({ dialog, Menu }) => {
    dialog.showMessageBox = async (...args) => { globalThis.aboutMessage = args.at(-1); return { response: 0 }; };
    Menu.getApplicationMenu().items[3].submenu.items.find(i => i.label === '关于学习日志工作台').click();
  });
  await expect.poll(() => remote.evaluate(() => Boolean(globalThis.aboutMessage))).toBe(true);
  const remoteMessage = await remote.evaluate(() => globalThis.aboutMessage);
  assert.ok(remoteMessage.detail.includes(`服务器版本：${currentVersion}`));
  assert.match(remoteMessage.detail, /服务器更新后/);
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: ['desktop and service versions', 'old server fallback', 'manual requests only', 'new version and fixed release link', 'no update', 'offline and retry enabled', 'remote client authenticated server version'], profile }, null, 2));
  console.log(evidence);
} finally {
  if (remote && remote.process().exitCode === null) {
    const closed = remote.waitForEvent('close', { timeout: 60000 });
    await remote.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().reverse().forEach(w => w.close())); await closed;
  }
  if (app.process().exitCode === null) {
    const closed = app.waitForEvent('close', { timeout: 60000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().reverse().forEach(w => w.close())); await closed;
  }
}

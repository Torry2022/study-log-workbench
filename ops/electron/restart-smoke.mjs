import { workspacePage } from './workspace-test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron, expect } = require('@playwright/test');
const electronRequire = createRequire(new URL('./package.json', import.meta.url));
const executablePath = process.argv[2] || electronRequire('electron');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-restart-smoke-'));
const root = path.join(profile, 'instance'), lock = path.join(root, 'data/.instance-operation.lock');
const evidence = path.resolve('.local', `desktop-restart-${Date.now()}`);
await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const passed = [];
let application;
async function start() {
  application = await electron.launch({ executablePath, args: process.argv[2] ? [] : [path.dirname(fileURLToPath(import.meta.url))], env, timeout: 60000 });
  return workspacePage(application);
}
async function end(event) {
  const closed = application.waitForEvent('close', { timeout: 60000 });
  await application.evaluate(({ BrowserWindow }, names) => {
    const window = BrowserWindow.getAllWindows()[0];
    for (const name of [].concat(names)) if (!window.isDestroyed()) window.emit(name, {});
  }, event).catch(error => {
    if (!/closed|destroyed/i.test(error.message)) throw error;
  });
  await closed; application = null;
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
}
try {
  let page = await start();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  const editor = page.locator('.cm-content'); await expect(editor).toBeVisible();
  await editor.click(); await editor.press('Control+A');
  await page.keyboard.insertText('### 重启合成记录\n\n保存后应在重新打开时保留。');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).click();
  assert.equal((await saved).status(), 200);
  await expect(page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true })).toBeDisabled();
  await editor.press('Control+End'); await page.keyboard.insertText('\n未保存草稿');
  await application.evaluate(({ dialog }) => { globalThis.prompts = 0; dialog.showMessageBoxSync = () => { globalThis.prompts++; return 0; }; });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('query-session-end', {}));
  await expect.poll(() => application.evaluate(() => globalThis.prompts)).toBe(1);
  await expect(editor).toContainText('未保存草稿');
  assert.equal((await page.evaluate(() => fetch(location.href).then(r => r.status))), 200);
  passed.push('query-session-end cancellation retains draft and running service');
  await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await end('query-session-end');
  page = await start(); await expect(page.locator('.markdown-preview')).toContainText('重启合成记录');
  passed.push('confirmed query-session-end drains services and reopens saved record');
  const bootOwner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json')));
  await end('session-end');
  passed.push('session-end fallback drains services and releases ownership');
  await fs.mkdir(lock);
  bootOwner.desktop.boot = '2000-01-01T00:00:00.000Z'; bootOwner.startedAt = '2000-01-01T01:00:00.000Z'; bootOwner.pid = process.pid;
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(bootOwner));
  page = await start(); await expect(page.locator('.markdown-preview')).toContainText('重启合成记录');
  assert.ok(await fs.stat(path.join(root, '.desktop-recovery', bootOwner.ownerId, 'owner.json')));
  passed.push('injected previous-boot record opens automatically and is preserved');
  const crashOwner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'))), oldUrl = page.url();
  const appPid = await application.evaluate(() => process.pid);
  assert.equal(appPid, crashOwner.pid);
  const closed = application.waitForEvent('close', { timeout: 60000 });
  process.kill(appPid, 'SIGKILL'); // The isolated app, not Playwright's Windows command wrapper.
  await closed; application = null;
  await expect.poll(async () => { try { await fetch(oldUrl, { signal: AbortSignal.timeout(1000) }); return false; } catch { return true; } }, { timeout: 60000 }).toBe(true);
  page = await start(); await expect(page.locator('.markdown-preview')).toContainText('重启合成记录');
  assert.ok(await fs.stat(path.join(root, '.desktop-recovery', crashOwner.ownerId, 'owner.json')));
  passed.push('actual parent crash lets workers drain and reopens without manual recovery');
  await page.screenshot({ path: path.join(evidence, 'reopened.png') });
  await end(['query-session-end', 'session-end']);
  passed.push('consecutive query/session events exit without duplicate recovery');
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed, profile, limitation: 'OS events and previous boot injected; no reboot of the user computer.' }, null, 2));
  console.log(evidence);
} finally { if (application) await application.close(); }

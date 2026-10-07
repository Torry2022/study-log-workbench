import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { backupInstance, restoreInstance } from '../archive.mjs';

const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron, expect } = require('@playwright/test');
const electronRequire = createRequire(new URL('./package.json', import.meta.url));
const executablePath = process.argv[2] || electronRequire('electron');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'study-log-electron-test-'));
const evidence = path.resolve('.local', `electron-smoke-${Date.now()}`);
await fs.mkdir(evidence);
const args = process.argv[2] ? [] : [here];
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
let application;
const passed = [];
const start = async () => {
  application = await electron.launch({ executablePath, args, env, timeout:60000 });
  const page = await application.firstWindow({ timeout:60000 });
  // Electron's will-prevent-unload handler owns this dialog; Playwright must not
  // auto-dismiss a Chromium dialog that Electron has already replaced.
  page.on('dialog', () => {});
  await expect(page.locator('.workspace')).toBeVisible({ timeout:60000 });
  return page;
};
const close = async () => {
  const ended = application.waitForEvent('close', { timeout:60000 });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await ended; application = null;
};
try {
  let page = await start();
  const root = JSON.parse(await fs.readFile(path.join(profile, 'desktop.json'), 'utf8')).root;
  assert.equal(root, path.join(profile, 'instance'));
  const lock = path.join(root, 'data/.instance-operation.lock');
  const initialOwner = await fs.readFile(path.join(lock, 'owner.json'), 'utf8');
  const webPreferences = await application.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration:p.nodeIntegration, sandbox:p.sandbox, contextIsolation:p.contextIsolation };
  });
  assert.deepEqual(webPreferences, { nodeIntegration:false, sandbox:true, contextIsolation:true });
  await expect(page.getByLabel('访问密码', { exact:true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  passed.push('default instance, automatic local authentication, isolated renderer');
  await page.evaluate(() => localStorage.setItem('desktop-synthetic-preference', 'retained'));
  const second = spawn(executablePath, args, { env, windowsHide:true, stdio:'ignore' });
  const [secondCode] = await once(second, 'exit'); assert.equal(secondCode, 0);
  assert.equal(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'), initialOwner);
  assert.equal(application.windows().length, 1);
  passed.push('second launch reuses existing window and service lock');
  await page.getByRole('button', { name:'今天', exact:true }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click(); await editor.press('Control+A');
  await page.keyboard.insertText('### 桌面合成记录\n\n通过桌面窗口记录 JavaScript 数组。\n\n```js\n[1, 2].map(n => n * 2)\n```');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/logs/day') && r.request().method()==='PUT');
  await page.getByRole('button', { name:'保存', exact:true }).filter({ visible:true }).click();
  assert.equal((await saved).status(), 200);
  await editor.press('Control+End'); await page.keyboard.insertText('\n待确认的草稿');
  await application.evaluate(({ dialog }) => { globalThis.closePrompts = 0; dialog.showMessageBoxSync = () => { globalThis.closePrompts++; return 0; }; });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => application.evaluate(() => globalThis.closePrompts)).toBe(1);
  await expect(editor).toContainText('待确认的草稿');
  await page.screenshot({ path:path.join(evidence, 'workspace.png') });
  passed.push('actual editor save and canceled close retain draft');
  await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await close();
  await assert.rejects(fs.stat(lock), { code:'ENOENT' });
  page = await start();
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-synthetic-preference')), 'retained');
  await expect(page.locator('.markdown-preview')).toContainText('桌面合成记录');
  await expect(page.locator('.markdown-preview')).not.toContainText('待确认的草稿');
  passed.push('discard confirmed; normal shutdown releases lock; reopen preserves saved data');
  await close();
  const archive = path.join(profile, 'synthetic.slarchive'), restored = path.join(profile, 'restored');
  await backupInstance(root, archive); await restoreInstance(archive, restored);
  page = await start();
  await application.evaluate(({ dialog, Menu }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[selected] });
    Menu.getApplicationMenu().items[0].submenu.items[0].click();
  }, restored);
  await expect.poll(async () => JSON.parse(await fs.readFile(path.join(profile, 'desktop.json'), 'utf8')).root, { timeout:60000 }).toBe(restored);
  await expect.poll(() => application.windows().length, { timeout:60000 }).toBe(1);
  page = application.windows()[0];
  page.on('dialog', () => {});
  await expect(page.locator('.workspace')).toBeVisible({ timeout:60000 });
  await expect(page.locator('.markdown-preview')).toContainText('桌面合成记录');
  await expect(page.getByRole('button', { name:'保存', exact:true }).filter({ visible:true })).toBeDisabled();
  await application.evaluate(({ dialog, ipcMain }) => {
    globalThis.exitDiagnostics = { requests:0, prompts:0 };
    ipcMain.on('workbench:close', () => globalThis.exitDiagnostics.requests++);
    dialog.showMessageBoxSync = () => { globalThis.exitDiagnostics.prompts++; return 0; };
  });
  const exiting = application.waitForEvent('close', { timeout:60000 });
  await page.locator('.topbar-actions').getByRole('button', { name:'退出', exact:true }).click();
  await exiting; application = null;
  await assert.rejects(fs.stat(path.join(restored, 'data/.instance-operation.lock')), { code:'ENOENT' });
  passed.push('existing backup/restore implementation; native menu opens restored instance');
  page = await start();
  await application.evaluate(({ dialog }) => {
    globalThis.serviceErrors = 0;
    dialog.showMessageBox = async () => { globalThis.serviceErrors++; return { response:0 }; };
  });
  const parentPid = await application.evaluate(() => process.pid);
  const children = JSON.parse((await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Filter "ParentProcessId = $env:STUDY_LOG_TEST_PID" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],
  { windowsHide:true, env:{ ...process.env, STUDY_LOG_TEST_PID:String(parentPid) } })).stdout);
  const web = (Array.isArray(children) ? children : [children]).find(child => /worker\.mjs"?\s+"?web"?\s/.test(child?.CommandLine));
  assert.ok(web, 'Only terminate the Web worker directly owned by this synthetic Electron process');
  process.kill(web.ProcessId);
  await expect.poll(() => application.evaluate(() => globalThis.serviceErrors), { timeout:15000 }).toBeGreaterThan(0);
  await close();
  assert.ok((await fs.stat(path.join(restored, 'data/.instance-operation.lock'))).isDirectory());
  passed.push('actual Web worker crash is reported; exit drains sibling service and retains recovery lock');
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed, profile, executablePath, packaged:Boolean(process.argv[2]) }, null, 2));
  console.log(JSON.stringify({ passed, evidence }));
} catch (error) {
  if (application) console.log('Desktop failure state', await application.evaluate(({ BrowserWindow }) => ({
    windows:BrowserWindow.getAllWindows().map(w => ({ destroyed:w.isDestroyed(), url:w.webContents.getURL() })), diagnostics:globalThis.exitDiagnostics
  })).catch(() => null));
  throw error;
} finally {
  if (application) {
    await application.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
    await close().catch(() => {});
  }
}

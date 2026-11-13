import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, webkit, _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const webRoot = path.resolve(import.meta.dirname, '..');
const evidence = path.resolve(webRoot, '..', '.local', `settings-dialog-${Date.now()}`);
const data = path.join(evidence, 'data');
await fs.mkdir(data, { recursive: true });
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: crypto.randomUUID() }));
await fs.writeFile(path.join(data, '2026-10_学习日志.md'), '## 2026-10-06\n\n### 合成记录\n\n用于测试。\n');
const reservation = http.createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
  cwd: webRoot, windowsHide: true, env: { ...process.env, LOG_ROOT: data, AI_SETTINGS_ROOT: path.join(evidence, 'config'), APP_PASSWORD: 'synthetic-password', SESSION_SECRET: crypto.randomBytes(32).toString('hex'), COOKIE_SECURE: 'false', CHAT_API_KEY: '', STUDY_LOG_MCP_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe']
});
let output = ''; server.stdout.on('data', chunk => { output += chunk; }); server.stderr.on('data', chunk => { output += chunk; });
const url = `http://127.0.0.1:${port}/study-log`;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt > 100 || server.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!process.env.SETTINGS_ELECTRON_ONLY) for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch();
    try {
      for (const mobile of [false, true]) for (const colorScheme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, colorScheme });
        await page.goto(url);
        await page.getByLabel('访问密码').fill('synthetic-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.locator('.workspace')).toBeVisible();
        if (!mobile) {
          await page.getByRole('button', { name: '源码', exact: true }).click();
          const editor = page.locator('.source-workspace:not(.source-workspace-hidden) .cm-content[contenteditable=true]');
          await expect(editor).toContainText('合成记录');
          await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('未保存的合成草稿');
        }
        let legacy = false, fail = false, settingsCalls = 0;
        await page.route('**/api/capabilities', async route => {
          const response = await route.fetch(); const json = await response.json();
          if (legacy) delete json.settings;
          else json.settings = { ai: { protocolVersion: 1, readable: true, writable: false } };
          await route.fulfill({ response, json });
        });
        await page.route('**/api/settings/ai', async route => {
          settingsCalls++;
          if (fail) return route.fulfill({ status: 503, json: { error: 'synthetic' } });
          await route.fulfill({ json: { instanceId: route.request().headers()['x-study-log-instance'], provider: 'custom', hasEndpoint: true, endpointDisplay: 'https://example.invalid', model: 'synthetic-model', hasKey: true, lightModel: '', source: 'config' } });
        });
        const open = async () => {
          if (mobile) { await page.getByRole('button', { name: '更多设置' }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); }
          else await page.getByRole('button', { name: '打开设置' }).click();
          return page.getByRole('dialog', { name: '设置', exact: true });
        };
        let dialog = await open();
        await expect(dialog).toContainText('synthetic-model');
        await expect(dialog).toContainText('https://example.invalid');
        await expect(dialog).toContainText('模型设置由工作台维护者管理');
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(evidence, `${name}-${mobile ? 'mobile' : 'desktop'}-${colorScheme}.png`) });
        await dialog.getByRole('button', { name: '关闭设置' }).click(); await expect(dialog).toBeHidden();
        if (!mobile) await expect(page.locator('.source-workspace:not(.source-workspace-hidden) .cm-content[contenteditable=true]')).toContainText('未保存的合成草稿');
        legacy = true; const previousCalls = settingsCalls;
        dialog = await open(); await expect(dialog).toContainText('当前服务器版本不支持查看详细设置');
        if (settingsCalls !== previousCalls) throw new Error('Legacy server should not be queried for settings');
        await dialog.getByRole('button', { name: '关闭设置' }).click(); await expect(dialog).toBeHidden();
        legacy = false; fail = true;
        dialog = await open(); await expect(dialog).toContainText('无法读取设置');
        fail = false; await dialog.getByRole('button', { name: '重试' }).click(); await expect(dialog).toContainText('synthetic-model');
        await dialog.getByRole('button', { name: '关闭设置' }).click(); await expect(dialog).toBeHidden();
        await page.close();
      }
    } finally { await browser.close(); }
  }
  const repo = path.resolve(webRoot, '..');
  const requireElectron = createRequire(path.join(repo, 'ops/electron/package.json'));
  const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: path.join(evidence, 'desktop-profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({ executablePath: requireElectron('electron'), args: [path.join(repo, 'ops/electron')], env, timeout: 60000 });
  try {
    await expect.poll(() => desktop.context().pages().some(page => page.url().includes('connection.html'))).toBe(true);
    const chooser = desktop.context().pages().find(page => page.url().includes('connection.html'));
    await chooser.locator('[value=remote]').check();
    await chooser.locator('[name=origin]').fill(`http://127.0.0.1:${port}`);
    await chooser.locator('[name=localHttp]').check();
    await chooser.locator('[name=password]').fill('synthetic-password');
    await chooser.getByRole('button', { name: '连接服务器', exact: true }).click().catch(error => { if (!chooser.isClosed()) throw error; });
    await expect.poll(() => desktop.context().pages().some(page => page.url().startsWith(url)), { timeout: 60000 }).toBe(true);
    const page = desktop.context().pages().find(page => page.url().startsWith(url));
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
    const openMenu = () => desktop.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '模型设置…'); if (!item.enabled) throw Error('Settings menu disabled'); item.click(); });
    await openMenu(); await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeHidden();
    await desktop.evaluate(({ dialog, ipcMain }) => { dialog.showMessageBox = async (_owner, options) => { globalThis.testSettingsFallback = options.message; return { response: 0 }; }; ipcMain.on('workbench:settings-unavailable', event => { globalThis.testSettingsSender = event.senderFrame.url; }); });
    await page.route('**/study-log**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Legacy server</title>' }));
    await page.reload();
    await expect(page).toHaveTitle('Legacy server');
    await openMenu();
    await expect.poll(() => desktop.evaluate(() => globalThis.testSettingsSender)).toContain('/study-log');
    await expect.poll(() => desktop.evaluate(() => globalThis.testSettingsFallback)).toBe('当前服务器暂不支持查看模型设置');
  } finally { await desktop.close(); }
  console.log(`Settings UI passed: ${evidence}`);
} catch (error) { console.error(output); throw error; } finally { server.kill(); }

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { workspacePage } from './workspace-test.mjs';
import { readAiSettings, saveAiSettings } from '../ai-settings.mjs';

const repo = path.resolve(import.meta.dirname, '../..');
const { _electron: electron, expect } = createRequire(path.join(repo, 'study-log-web/package.json'))('@playwright/test');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-workspace-'));
const evidence = path.join(profile, 'evidence'); await fs.mkdir(evidence);
const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [path.join(repo, 'ops/electron')], env, timeout: 60000 });
try {
  const page = await workspacePage(app), root = JSON.parse(await fs.readFile(path.join(profile, 'desktop.json'), 'utf8')).root;
  await page.getByRole('button', { name: '今天', exact: true }).click();
  const editor = page.locator('.cm-content[contenteditable=true]').first(); await editor.click(); await page.keyboard.insertText('未保存的合成材料');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '模型设置…').click());
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(dialog.getByRole('combobox').first()).toBeVisible();
  await dialog.getByRole('combobox').first().selectOption('custom');
  await dialog.getByLabel('完整接口地址').fill('https://example.invalid/private?token=synthetic');
  await dialog.getByLabel('API Key').fill('synthetic-key'); await dialog.getByLabel('模型', { exact: true }).fill('synthetic-model');
  await app.evaluate(({ ipcMain }) => { const old = ipcMain._invokeHandlers.get('workbench:configure'); ipcMain.removeHandler('workbench:configure'); ipcMain.handle('workbench:configure', async (...args) => { await old(...args); throw Error('synthetic lost response'); }); });
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('无法确认保存结果');
  assert.equal((await readAiSettings(path.join(root, 'config'))).values.CHAT_MODEL, 'synthetic-model');
  await dialog.getByRole('button', { name: '核对最新设置' }).click(); await expect(dialog.getByRole('status')).toContainText('已确认设置保存成功');
  await expect(dialog.getByLabel('API Key')).toHaveValue(''); await expect(dialog).not.toContainText('synthetic-key'); await expect(dialog).not.toContainText('token=synthetic');
  await dialog.getByLabel('API Key').fill('pending-old-key');
  const current = await readAiSettings(path.join(root, 'config'));
  await saveAiSettings({ root: path.join(root, 'config'), instanceId: current.instanceId, expectedRevision: current.revision, operationId: crypto.randomUUID(), values: { ...current.values, CHAT_API_URL: 'https://other.invalid/new', CHAT_API_KEY: 'other-key' }, keyAction: 'replace' });
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('另一处更新');
  await dialog.getByRole('button', { name: '核对最新设置' }).click(); await expect(dialog.getByRole('status')).toContainText('重新填写密钥');
  await expect(dialog.getByLabel('API Key')).toHaveValue('');
  await dialog.getByRole('button', { name: '已核对，继续编辑' }).click();
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('请输入完整接口地址');
  await dialog.getByRole('button', { name: '关闭设置' }).click(); await page.getByRole('button', { name: '放弃并关闭' }).click();
  await expect(editor).toContainText('未保存的合成材料');
  console.log(`Settings workspace smoke passed: ${evidence}`);
} finally {
  await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.getAllWindows().forEach(window => window.close()); }).catch(() => {});
  await app.close().catch(() => {});
}

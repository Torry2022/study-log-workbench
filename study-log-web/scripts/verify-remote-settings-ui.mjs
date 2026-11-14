import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, webkit, expect } from '@playwright/test';
import { initializeAiSettings, readAiSettings } from '../../ops/ai-settings.mjs';

const webRoot = path.resolve(import.meta.dirname, '..'), evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-settings-ui-'));
for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const root = path.join(evidence, engineName), data = path.join(root, 'data'), config = path.join(root, 'config'); await fs.mkdir(data, { recursive: true }); await fs.mkdir(config);
  const id = crypto.randomUUID(), target = 'https://example.invalid/chat/completions', password = 'SyntheticOnlyPass42';
  await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id })); await fs.writeFile(path.join(data, '2026-10_学习日志.md'), '## 2026-10-06\n\n### 合成记录\n\n用于验证。\n');
  await initializeAiSettings({ root: config, instanceId: id, env: { CHAT_API_URL: target, CHAT_API_KEY: 'synthetic-original-key', CHAT_MODEL: 'original' } });
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`, baseUrl = `${origin}/study-log`;
  const env = { ...process.env, LOG_ROOT: data, AI_SETTINGS_ROOT: config, APP_PASSWORD: password, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), COOKIE_SECURE: 'false', AI_SETTINGS_REMOTE_WRITE_ENABLED: 'true', AI_SETTINGS_ALLOWED_ENDPOINTS: JSON.stringify([target]), AI_SETTINGS_PUBLIC_ORIGIN: origin, CHAT_API_KEY: '', STUDY_LOG_MCP_TOKEN: '' };
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: webRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; server.stderr.on('data', chunk => { output += chunk; });
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(baseUrl)).ok) break; } catch {} if (i > 100 || server.exitCode !== null) throw Error(output); await new Promise(resolve => setTimeout(resolve, 100)); }
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await page.goto(baseUrl);
      await page.getByLabel('访问密码').fill(password); await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('button', { name: '打开设置' }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true });
      await dialog.getByRole('button', { name: 'AI 服务' }).click(); await expect(dialog.getByLabel('模型', { exact: true })).toHaveValue('original');
      await dialog.getByLabel('模型', { exact: true }).fill('unsaved-model');
      const content = dialog.locator('.settings-dialog-content');
      await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await dialog.getByRole('button', { name: '外观', exact: true }).click();
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
      await dialog.getByRole('button', { name: 'AI 服务' }).click();
      await expect(dialog.getByLabel('模型', { exact: true })).toHaveValue('unsaved-model');
      await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
      let payload; await page.route('**/api/settings/ai', async route => { if (route.request().method() === 'PUT') payload = route.request().postDataJSON(); await route.continue(); });
      await dialog.getByLabel('API Key').fill('unused-draft-key'); await dialog.getByLabel('移除已保存的 Key').check();
      await dialog.getByRole('button', { name: '保存设置', exact: true }).click(); let confirm = page.getByRole('dialog', { name: '确认工作台密码' }); await confirm.getByLabel('访问密码').fill(password); await confirm.getByRole('button', { name: '确认', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('设置已保存'); assert.equal(payload.keyAction, 'remove'); assert.equal('key' in payload, false); assert.equal((await readAiSettings(config, id)).values.CHAT_API_KEY, '');
      await page.unroute('**/api/settings/ai');
      await dialog.getByLabel('模型', { exact: true }).fill('lost-response-model');
      await page.route('**/api/settings/ai', async route => { if (route.request().method() === 'PUT') { await route.fetch(); await route.abort('failed'); } else await route.continue(); });
      await dialog.getByRole('button', { name: '保存设置', exact: true }).click(); confirm = page.getByRole('dialog', { name: '确认工作台密码' }); await confirm.getByLabel('访问密码').fill(password); await confirm.getByRole('button', { name: '确认', exact: true }).click();
      await expect(dialog.getByRole('status')).toContainText('无法确认保存结果'); assert.equal((await readAiSettings(config, id)).values.CHAT_MODEL, 'lost-response-model');
      const receipts = await page.evaluate(() => JSON.stringify(sessionStorage)); assert.ok(!receipts.includes('unused-draft-key')); assert.ok(!receipts.includes('SyntheticOnlyPass42'));
      await page.unroute('**/api/settings/ai'); await dialog.getByRole('button', { name: '关闭设置' }).click(); await page.getByRole('button', { name: '放弃并关闭' }).click(); await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: '打开设置' }).click(); await dialog.getByRole('button', { name: 'AI 服务' }).click(); await dialog.getByRole('button', { name: '核对最新设置' }).click(); await expect(dialog.getByRole('status')).toContainText('已确认设置保存成功');
      await page.waitForTimeout(250); await page.screenshot({ path: path.join(root, 'settings.png') });
      await dialog.getByRole('button', { name: '关闭设置' }).click(); await expect(dialog).toBeHidden();
      const material = page.getByPlaceholder('粘贴笔记、代码片段、课程内容或项目进展');
      if (!await material.isVisible()) await page.getByRole('button', { name: 'AI生成', exact: true }).first().click();
      await material.fill('保存设置后保留的合成学习材料');
      await page.getByRole('button', { name: '打开 AI 设置', exact: true }).first().click();
      await expect(dialog.getByLabel('模型', { exact: true })).toHaveValue('lost-response-model');
      let readiness = 'normal', capabilityReads = 0, updates = 0;
      await page.route('**/api/capabilities', async route => {
        capabilityReads++;
        if (readiness === 'fail') return route.fulfill({ status: 503, json: { error: 'synthetic-readiness-failure' } });
        const response = await route.fetch(), json = await response.json();
        if (readiness === 'ready') { json.features.aiWriting.configured = true; json.aiConfiguration.provider.configured = true; json.aiConfiguration.provider.issues = []; json.aiConfiguration.writing = { configured: true, issues: [] }; }
        await route.fulfill({ response, json });
      });
      await page.route('**/api/settings/ai', async route => { if (route.request().method() === 'PUT') updates++; await route.continue(); });
      const saveModel = async model => {
        await dialog.getByLabel('模型', { exact: true }).fill(model);
        await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
        const prompt = page.getByRole('dialog', { name: '确认工作台密码' });
        await prompt.getByLabel('访问密码').fill(password); await prompt.getByRole('button', { name: '确认', exact: true }).click();
      };
      readiness = 'fail'; await saveModel('saved-but-readiness-failed');
      await expect(dialog.getByRole('alert')).toContainText('设置已保存，功能状态暂未更新');
      await expect(dialog).toBeVisible(); assert.equal(updates, 1);
      await expect(dialog.getByLabel('模型', { exact: true })).toBeEnabled();
      readiness = 'ready'; const before = capabilityReads; await saveModel('feature-return-model');
      await expect(dialog).toBeHidden(); await expect(material).toHaveValue('保存设置后保留的合成学习材料');
      await expect.poll(() => capabilityReads - before).toBeGreaterThanOrEqual(2);
      assert.equal(updates, 2); await expect(page.getByRole('button', { name: '生成日志草稿', exact: true })).toBeEnabled();
      await page.screenshot({ path: path.join(root, 'feature-return.png') });
      await page.unroute('**/api/capabilities'); await page.unroute('**/api/settings/ai');
    } finally { await browser.close(); }
  } finally { server.kill(); }
}
console.log(`Remote settings UI passed: ${evidence}`);

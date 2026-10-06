import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base = 'http://127.0.0.1:3686/study-log'] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Explicit local synthetic instance required');
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const browser = await chromium.launch();
const prefix = `合成方案${Date.now()}`;
let page, originalDefault;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // No paid provider calls: only the generation endpoint is replaced; all preset reads/writes are real.
  let generatedWith;
  await page.route('**/api/ai/generate', async route => {
    generatedWith = route.request().postDataJSON().presetId;
    await route.fulfill({ json: { result: { content: '### 合成生成片段\n\n仅供测试审阅。', model: 'synthetic', warnings: [] } } });
  });
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch(), json = await response.json();
    if (response.ok()) { json.features.aiWriting = { supported: true, configured: true }; json.aiConfiguration.provider = { configured: true, issues: [] }; }
    await route.fulfill({ response, json });
  });
  await page.goto(`${base}?date=2026-02-05`);
  await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.workspace').waitFor();
  const api = `${base}/api/ai/generation-presets`;
  const read = async () => { const response = await page.request.get(api); assert.equal(response.status(), 200); return response.json(); };
  originalDefault = (await read()).defaultPresetId;
  if (!await page.locator('.writing-panel').isVisible()) await page.getByRole('button', { name: 'AI生成', exact: true }).filter({ visible: true }).click();
  const picker = page.getByLabel('生成方案', { exact: true }); await expect(picker).toBeEnabled();
  await picker.selectOption('builtin:practice');
  await page.getByLabel('学习材料', { exact: true }).fill('SYNTHETIC_PRESET_MATERIAL');
  await page.getByRole('button', { name: '管理生成方案', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '生成方案', exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveAttribute('readonly', '');
  await dialog.getByRole('button', { name: '新增方案', exact: true }).click();
  await expect(dialog.getByLabel('方案名称', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '保存方案', exact: true })).toBeDisabled();
  await dialog.getByLabel('方案名称', { exact: true }).fill(`${prefix}空白新增`);
  await dialog.getByLabel('提示词', { exact: true }).fill('从空白创建的合成方案，不虚构学习经历。');
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('方案已保存');
  assert.equal((await read()).presets.find(item => item.name === `${prefix}空白新增`).prompt, '从空白创建的合成方案，不虚构学习经历。');
  await dialog.getByRole('button', { name: /^实践与排错/ }).click();
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveAttribute('readonly', '');
  await dialog.getByRole('button', { name: '复制', exact: true }).click();
  await dialog.getByLabel('方案名称', { exact: true }).fill(prefix);
  await dialog.getByLabel('提示词', { exact: true }).fill('合成自定义方案内容');
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('方案已保存');
  let state = await read(); const id = state.presets.find(item => item.name === prefix).id;
  await dialog.getByRole('button', { name: '设为默认', exact: true }).click(); await expect(dialog.getByRole('status')).toHaveText('默认方案已更新');
  assert.equal((await read()).defaultPresetId, id);
  await dialog.getByRole('button', { name: '关闭生成方案', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(picker).toHaveValue(id); await expect(page.getByLabel('学习材料', { exact: true })).toHaveValue('SYNTHETIC_PRESET_MATERIAL');
  const day = async () => {
    const response = await page.request.get(`${base}/api/logs/day?date=2026-02-05`);
    assert.equal(response.status(), 200); return (await response.json()).day;
  };
  const beforeGeneration = await day();
  await page.getByRole('button', { name: '生成日志草稿', exact: true }).click();
  await expect(page.getByLabel('生成草稿', { exact: true })).toHaveValue(/合成生成片段/); assert.equal(generatedWith, id);
  assert.equal((await day()).version, beforeGeneration.version, 'Generating a preset draft must not save it');
  const reviewed = `### 合成生成片段\n\n仅供测试审阅。\n\n${prefix}人工审阅修订。`;
  await page.getByLabel('生成草稿', { exact: true }).fill(reviewed);
  await page.getByRole('button', { name: '追加到编辑器', exact: true }).click();
  await expect(page.locator('.writing-panel')).toContainText('尚未保存');
  assert.equal((await day()).version, beforeGeneration.version, 'Reviewing and appending must not save implicitly');
  const editor = page.locator('.cm-content').filter({ visible: true });
  await expect(editor).toContainText(`${prefix}人工审阅修订。`);
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(`\n\n${prefix}编辑器补充。`);
  assert.equal((await day()).version, beforeGeneration.version, 'Editing the appended draft must not save implicitly');
  await page.getByRole('button', { name: '保存', exact: true }).filter({ visible: true }).first().click();
  await expect.poll(async () => (await day()).content).toContain(`${prefix}人工审阅修订。`);
  const savedDay = await day();
  assert.ok(savedDay.content.includes(`${prefix}编辑器补充。`));
  assert.ok(savedDay.content.includes(beforeGeneration.content.trim()), 'Applying a preset draft must preserve existing saved content');
  assert.notEqual(savedDay.version, beforeGeneration.version);
  await page.getByRole('button', { name: '管理生成方案', exact: true }).click();
  await dialog.getByLabel('提示词', { exact: true }).fill('未保存草稿需要保留');
  await dialog.getByRole('button', { name: '关闭生成方案', exact: true }).click();
  const confirmation = page.getByRole('alertdialog'); await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click(); await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveValue('未保存草稿需要保留');
  state = await read();
  assert.equal((await page.request.patch(api, { data: { version: state.version, id, name: prefix, prompt: '来自另一页面的修订' } })).status(), 200);
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('其他页面修改');
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveValue('未保存草稿需要保留');
  assert.equal((await read()).presets.find(item => item.id === id).prompt, '来自另一页面的修订');
  await dialog.getByRole('button', { name: '查看最新内容', exact: true }).click();
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveValue('未保存草稿需要保留');
  await dialog.locator('summary').filter({ hasText: '最新保存内容' }).click();
  await expect(dialog.locator('.generation-presets-comparison')).toContainText('来自另一页面的修订');
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('方案已保存');
  assert.equal((await read()).presets.find(item => item.id === id).prompt, '未保存草稿需要保留');
  await dialog.getByLabel('提示词', { exact: true }).fill('明确放弃的本地修订');
  await dialog.getByRole('button', { name: '重新载入', exact: true }).click(); await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '放弃', exact: true }).click(); await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByLabel('提示词', { exact: true })).toHaveValue('未保存草稿需要保留');
  await dialog.getByLabel('方案名称', { exact: true }).fill(`${prefix}重命名`);
  await dialog.getByRole('button', { name: '保存方案', exact: true }).click(); await expect(dialog.getByRole('status')).toHaveText('方案已保存');
  assert.equal((await read()).presets.find(item => item.id === id).name, `${prefix}重命名`);
  const artifacts = path.resolve('.local/generation-presets-acceptance'); await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'desktop.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await dialog.getByRole('button', { name: '删除', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, 'mobile-dark.png') });
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '删除', exact: true }).click(); await expect(confirmation).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('方案已删除');
  state = await read(); assert.equal(state.defaultPresetId, 'legacy'); assert.ok(!state.presets.some(item => item.id === id));
  await dialog.getByRole('button', { name: '关闭生成方案', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(picker).toHaveValue('legacy');
  assert.deepEqual(errors, []);
  console.log('Passed: blank preset creation, real preset CRUD/default/version conflict, unsaved preservation, selected mock generation, review/append/explicit save/readback, nested confirmation, narrow layout and default fallback; no paid model calls');
} finally {
  if (page && originalDefault) {
    const api = `${base}/api/ai/generation-presets`;
    let response = await page.request.get(api);
    if (response.ok()) {
      let state = await response.json();
      for (const item of state.presets.filter(item => !item.readOnly && item.name.startsWith(prefix))) {
        response = await page.request.delete(api, { data: { version: state.version, id: item.id } });
        if (response.ok()) state = await response.json();
      }
      if (state.defaultPresetId !== originalDefault) await page.request.patch(api, { data: { version: state.version, defaultPresetId: originalDefault } });
    }
  }
  await browser.close();
}

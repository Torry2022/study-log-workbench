import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initialize } from '../instance.mjs';
import { createRagSession } from '../../study-log-web/lib/rag-sessions-store.ts';
import { workspacePage } from './workspace-test.mjs';

assert.ok(process.argv[2], 'Pass the isolated candidate EXE');
const executable = path.resolve(process.argv[2]), root = path.resolve('.local', `electron-qa-sidebar-${Date.now()}`), instance = path.join(root, 'instance'), profile = path.join(root, 'profile');
const packageManifest = JSON.parse(await fs.readFile(path.join(path.dirname(executable), 'resources/payload/package-manifest.json'), 'utf8'));
assert.equal(packageManifest.webBuild, (await fs.readFile('study-log-web/.next-build-cache/BUILD_ID', 'utf8')).trim());
await initialize(instance); await fs.mkdir(profile);
await fs.writeFile(path.join(profile, 'desktop.json'), JSON.stringify({ mode: 'local', usageConfirmed: true, root: instance }));
process.env.LOG_ROOT = path.join(instance, 'data'); process.env.BACKUP_ROOT = path.join(instance, 'backups');
const sessions = {};
for (const [name, count] of [['short', 1], ['long', 70]]) {
  const session = await createRagSession({ id: randomUUID(), mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages: [
    { id: randomUUID(), role: 'user', content: '合成布局问题', status: 'complete' },
    { id: randomUUID(), role: 'assistant', content: Array.from({ length: count }, (_, i) => `合成第${i}段：${'用于检查嵌入窗口布局。'.repeat(8)}`).join('\n\n'), status: 'complete', citations: [] }] });
  sessions[name] = session.id;
}
const { _electron: electron, expect } = createRequire(new URL('../../study-log-web/package.json', import.meta.url))('@playwright/test');
const environment = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete environment.ELECTRON_RUN_AS_NODE;
let app, page; const report = { root, executable, installed: false, samples: [], checks: [], errors: [], paidCalls: 0 };
try {
  app = await electron.launch({ executablePath: executable, args: [], env: environment, timeout: 60000 }); page = await workspacePage(app);
  report.version = await app.evaluate(({ app }) => app.getVersion()); report.webBuild = packageManifest.webBuild;
  assert.equal(report.version, packageManifest.version);
  assert.equal((await app.evaluate(({ app }) => app.getPath('userData'))).toLowerCase(), profile.toLowerCase());
  page.on('pageerror', error => report.errors.push(error.message));
  const base = new URL(page.url()).origin + '/study-log';
  for (const theme of ['light', 'dark']) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: '切换主题模式', exact: true }).click();
    await page.getByRole('button', { name: theme === 'dark' ? '夜间模式' : '日间模式', exact: true }).click();
    for (const [name, id] of Object.entries(sessions)) {
      await page.goto(`${base}?view=qa&session=${id}`); await expect(page.locator('.rag-answer')).toContainText('合成第0段');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const [width, height] of [[1280, 800], [1100, 720], [1440, 900]]) {
        await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0].setSize(...size); }, [width, height]);
        for (const position of ['top', 'middle', 'bottom', 'top']) {
          await page.evaluate(position => window.scrollTo(0, position === 'top' ? 0 : position === 'bottom' ? document.documentElement.scrollHeight : document.documentElement.scrollHeight / 2), position);
          await page.waitForTimeout(220);
          const sample = await page.locator('.qa-sidebar').evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: innerHeight, width: innerWidth, y: scrollY,
              owned: Boolean(document.elementFromPoint(rect.left + rect.width / 2, innerHeight - 2)?.closest('.qa-sidebar')) };
          });
          report.samples.push({ theme, name, width, height, position, ...sample });
          assert.ok(sample.bottom >= sample.height - 1 && sample.owned, JSON.stringify(report.samples.at(-1)));
        }
      }
      await page.screenshot({ path: path.join(root, `${theme}-${name}.png`) }); report.checks.push({ theme, name });
    }
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; await page?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally {
  if (app) { const closed = app.waitForEvent('close', { timeout: 60000 }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close())); await closed; }
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}

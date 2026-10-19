import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// Run with the candidate's bundled Node and unpacked EXE. No installation,
// archive restore, production instance or external model is used here.
const repo = path.resolve(import.meta.dirname, '../..');
assert.ok(process.argv[2], 'Pass the unpacked candidate EXE');
const executable = path.resolve(process.argv[2]);
const payload = path.join(path.dirname(executable), 'resources/payload');
assert.equal(path.resolve(process.execPath).toLowerCase(), path.join(payload, 'runtime/node.exe').toLowerCase());
const { DesktopManager } = await import(pathToFileURL(path.join(payload, 'ops/desktop/manager.mjs')));
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const { _electron: electron, chromium, expect } = require('@playwright/test');
const root = path.join(repo, '.local', `rag-windows-tasks-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const report = { root, executable, payload, checks: [], screenshots: [], processSnapshots: [], requests: [], modelRequests: [], errors: [], paidModelCalls: 0, installed: false };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 25000) {
  const start = Date.now();
  while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(60); }
}
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let app, browser, active = 0, streams = 0;
const pending = new Map(), managers = [];
const source = '## 2026-09-01\n\n### 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const model = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw); report.modelRequests.push({ stream: input.stream === true, model: input.model });
    if (!input.stream) {
      const title = input.messages?.[0]?.content?.includes('短语式标题');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: title ? '合成保存问答' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); return;
    }
    const n = ++streams; active++; pending.set(n, res); res.setHeader('content-type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `合成回答${n}：先确认内容` }, finish_reason: null }] })}\n\n`);
    res.once('close', () => { active--; pending.delete(n); });
  } catch (error) { res.destroy(error); }
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = n => {
  const res = pending.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
};
async function prepare(name) {
  const instance = path.join(root, `${name}-instance`), password = `Synthetic-${randomUUID()}`;
  const manager = new DesktopManager({ packageRoot: payload, node: process.execPath }); managers.push(manager);
  await manager.select({ root: instance, create: true, password });
  await manager.configure({ apiUrl: `http://127.0.0.1:${model.address().port}/chat`, model: 'synthetic-windows-model', apiKey: 'synthetic-windows-key' });
  const envFile = path.join(instance, '.env'), env = parseEnv(await fs.readFile(envFile, 'utf8'));
  Object.assign(env, { CHAT_LIGHT_MODEL: 'synthetic-windows-model', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' });
  await fs.writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n');
  const sourceFile = path.join(instance, 'data/2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
  return { instance, manager, password, sourceFile };
}
async function launch(profile) {
  const env = { ...process.env, STUDY_LOG_DESKTOP_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
  app.process().stderr.on('data', bytes => { void fs.appendFile(path.join(root, 'electron-stderr.log'), bytes).catch(() => {}); });
  report.electron = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, versions: process.versions, profile: app.getPath('userData') }));
  assert.equal(report.electron.packaged, true); assert.equal(report.electron.profile.toLowerCase(), profile.toLowerCase());
}
async function closeApp() {
  if (!app) return;
  const closing = app.waitForEvent('close', { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.close()));
  await closing; app = undefined;
}
async function workspace() {
  await expect.poll(() => app.context().pages().some(p => !p.isClosed() && /^http:/.test(p.url())), { timeout: 60000 }).toBe(true);
  const page = app.context().pages().find(p => !p.isClosed() && /^http:/.test(p.url()));
  page.setDefaultTimeout(20000); page.on('dialog', () => {});
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('request', request => { if (request.url().includes('/api/rag/')) report.requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60000 });
  report.webSandbox = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => /^http:/.test(c.getURL())).map(c => { const p = c.getLastWebPreferences(); return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox }; }));
  assert.ok(report.webSandbox.length); assert.ok(report.webSandbox.every(p => !p.nodeIntegration && p.contextIsolation && p.sandbox));
  return page;
}
async function qa(page, sessionId) {
  const base = new URL(page.url()).origin + '/study-log';
  await page.goto(`${base}?view=qa${sessionId ? `&session=${sessionId}` : ''}`);
  await expect(page.getByRole('textbox', { name: '输入知识库问题', exact: true })).toBeVisible();
}
// Electron's Chinese application name appears in its User-Agent, which the
// Playwright Node request client rejects. Use the real window's fetch/cookies.
const api = (page, route) => page.evaluate(async route => {
  const response = await fetch('/study-log/api' + route);
  return { status: response.status, body: await response.json() };
}, route);
const tasks = async page => (await api(page, '/rag/tasks')).body.tasks;
const task = async (page, id) => (await api(page, `/rag/tasks/${id}`)).body.task;
async function send(page) {
  const n = streams + 1;
  await page.getByRole('textbox', { name: '输入知识库问题', exact: true }).fill('合成保存应如何操作？');
  await page.getByRole('button', { name: '发送问题', exact: true }).click(); await until(() => streams, value => value === n);
  const sessionId = new URL(page.url()).searchParams.get('session'); assert.ok(sessionId);
  const list = await until(() => tasks(page), list => list.some(t => t.sessionId === sessionId));
  const id = list.find(t => t.sessionId === sessionId).id;
  await until(() => task(page, id), t => t.state === 'running' && t.partial.includes(`合成回答${n}`));
  return { id, sessionId, n };
}
async function independent(base, password, sessionId) {
  browser ??= await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage(); await page.goto(base); await page.getByLabel('访问密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.locator('.workspace')).toBeVisible();
  await qa(page, sessionId); return page;
}
async function snapshot(name, pid) {
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const processes = JSON.parse(stdout), ids = new Set([pid]);
  for (let n = 0; n < processes.length; n++) for (const p of processes) if (ids.has(p.ParentProcessId)) ids.add(p.ProcessId);
  const own = processes.filter(p => ids.has(p.ProcessId)); report.processSnapshots.push({ name, pid, processes: own }); return own;
}
async function screenshot(page, name) {
  const target = path.join(root, name + '.png'); await page.screenshot({ path: target }); report.screenshots.push(target);
}
function databaseTask(instance, id) {
  const db = new DatabaseSync(path.join(instance, 'data/state/rag-tasks.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id,state,partial,error,save_state,revision FROM tasks WHERE id=?').get(id); } finally { db.close(); }
}
try {
  const manifest = JSON.parse(await fs.readFile(path.join(payload, 'package-manifest.json'), 'utf8'));
  report.package = manifest; report.runtime = { executable: process.execPath, node: process.version, sha256: hash(await fs.readFile(process.execPath)) };
  assert.equal(process.version, 'v' + manifest.node.version); assert.equal(report.runtime.sha256, manifest.node.executableSha256);
  assert.equal((await fs.readFile(path.join(payload, 'web/.next-build-cache/BUILD_ID'), 'utf8')).trim(), manifest.webBuild);
  assert.equal((await fs.readFile(path.join(repo, 'study-log-web/.next-build-cache/BUILD_ID'), 'utf8')).trim(), manifest.webBuild);
  const approvedManifest = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repo, '.local/rag-tasks-stage-20261018/client-results-source-manifest.json');
  const approved = JSON.parse(await fs.readFile(approvedManifest, 'utf8'));
  const approvedFiles = approved.filter(file => !file.path.startsWith('docs/') && file.path !== 'ops/electron/rag-tasks-smoke.mjs');
  const changed = [];
  for (const file of approvedFiles) if (hash(await fs.readFile(path.join(repo, file.path))) !== file.sha256) changed.push(file.path);
  assert.deepEqual(changed, []); report.approvedManifest = approvedManifest; report.approvedNonDocFilesUnchanged = approvedFiles.length;
  const sqlite = path.join(root, 'bundled-runtime.sqlite'); let db = new DatabaseSync(sqlite);
  db.exec('CREATE TABLE runtime (value TEXT NOT NULL)'); db.prepare('INSERT INTO runtime VALUES (?)').run('synthetic Windows SQLite'); db.close();
  db = new DatabaseSync(sqlite); assert.equal(db.prepare('SELECT value FROM runtime').get().value, 'synthetic Windows SQLite'); db.close();
  record('candidate bundled Node hash/version, SQLite disk roundtrip and approved web source/build identity');

  const remote = await prepare('remote'); await remote.manager.start(); const remoteBase = remote.manager.url;
  const remotePids = remote.manager.processes.map(item => item.child.pid); report.remoteWorkerPids = remotePids;
  const remoteProfile = path.join(root, 'remote-profile'); await launch(remoteProfile);
  await expect.poll(() => app.context().pages().some(p => p.url().includes('connection.html'))).toBe(true);
  const chooser = app.context().pages().find(p => p.url().includes('connection.html'));
  await chooser.locator('[value=remote]').check(); await chooser.locator('[name=origin]').fill(new URL(remoteBase).origin);
  await chooser.locator('[name=localHttp]').check(); await chooser.locator('[name=password]').fill(remote.password);
  await chooser.getByRole('button', { name: '连接服务器', exact: true }).click();
  let page = await workspace(); await qa(page); const remoteTask = await send(page);
  const remoteProcesses = await snapshot('remote-electron-running', app.process().pid);
  assert.equal(remoteProcesses.filter(p => /worker\.mjs/.test(p.CommandLine || '')).length, 0);
  assert.equal(await fs.stat(path.join(remoteProfile, 'instance')).catch(() => null), null);
  const observer = await independent(remoteBase, remote.password, remoteTask.sessionId);
  await expect(observer.locator('.rag-workspace').filter({ visible: true })).toContainText(`合成回答${remoteTask.n}`);
  await screenshot(page, 'remote-running');
  record('actual remote Electron submits once; independent browser discovers partial task; no local workers or instance');
  const beforeClose = streams; await closeApp(); assert.equal(streams, beforeClose); assert.ok(pending.has(remoteTask.n));
  for (const pid of remotePids) assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal((await task(observer, remoteTask.id)).state, 'running');
  finish(remoteTask.n); await until(() => task(observer, remoteTask.id), t => t.state === 'succeeded' && t.saveState === 'saved');
  await expect(observer.locator('.rag-workspace').filter({ visible: true })).toContainText('再保存。');
  record('normal remote window close leaves packaged server/model alive; answer completes and saves without its window');
  await launch(remoteProfile); page = await workspace(); await qa(page, remoteTask.sessionId);
  await expect(page.locator('.rag-workspace').filter({ visible: true }).locator('.rag-message')).toHaveCount(2);
  await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText(`合成回答${remoteTask.n}`);
  assert.equal(streams, beforeClose); const saved = (await api(page, `/rag/sessions/${remoteTask.sessionId}`)).body.session;
  assert.equal(saved.messages.length, 2); assert.ok(saved.messages[1].citations.length);
  await screenshot(page, 'remote-reopened-saved');
  const delayedCancel = await send(page);
  await pause(15000);
  await page.evaluate(() => window.scrollBy(0, -20));
  const backToTop = page.locator('.back-to-top-control.is-visible');
  await expect(backToTop).toBeVisible();
  const floating = await backToTop.boundingBox(), composer = await page.locator('.rag-composer').boundingBox();
  assert.ok(floating && composer && floating.y + floating.height <= composer.y, 'visible return-to-top must clear the entire composer');
  await screenshot(page, 'remote-cancel-controls');
  const cancelledAt = Date.now();
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await until(() => active, value => value === 0, 5000);
  await until(() => task(page, delayedCancel.id), value => value.state === 'cancelled');
  const cancelledDb = new DatabaseSync(path.join(remote.instance, 'data/state/rag-tasks.sqlite'), { readOnly: true });
  try { assert.equal(cancelledDb.prepare('SELECT count(*) n FROM leases').get().n, 0); } finally { cancelledDb.close(); }
  assert.equal((await api(page, `/rag/sessions/${remoteTask.sessionId}`)).body.session.messages.length, 2);
  report.delayedCancel = { heldMs: 15000, cleanupMs: Date.now() - cancelledAt, active, leases: 0 };
  record('actual remote Electron cancels a 15-second held body, closes upstream and releases its lease without saving the partial');
  await closeApp();
  assert.equal((await fs.readFile(path.join(remoteProfile, 'desktop.json'), 'utf8')).includes(remote.password), false);
  report.remoteTask = { ...remoteTask, state: 'succeeded', saveState: 'saved', messages: saved.messages.length, citations: saved.messages[1].citations.length };
  record('remote profile reopens cited server-saved pair without duplicate generation or client-side session write');
  await observer.context().close(); await remote.manager.shutdown();

  const local = await prepare('local'), localProfile = path.join(root, 'local-profile');
  await fs.mkdir(localProfile); await fs.writeFile(path.join(localProfile, 'desktop.json'), JSON.stringify({ usageConfirmed: true, mode: 'local', root: local.instance }));
  await launch(localProfile); page = await workspace(); const localBase = new URL(page.url()).origin + '/study-log';
  await qa(page); const localTask = await send(page);
  const firstTaskFile = JSON.parse(await fs.readFile(path.join(local.instance, 'data/state/rag-sessions.json'), 'utf8'));
  assert.deepEqual(firstTaskFile.taskReceipts, []); assert.deepEqual(firstTaskFile.sessions, []);
  const own = await snapshot('local-electron-running', app.process().pid), workers = own.filter(p => /worker\.mjs/.test(p.CommandLine || ''));
  assert.equal(workers.length, 2); assert.ok(workers.every(p => p.ExecutablePath.toLowerCase() === process.execPath.toLowerCase()));
  report.localWorkerPids = workers.map(p => p.ProcessId);
  const localObserver = await independent(localBase, local.password, localTask.sessionId);
  await expect(localObserver.locator('.rag-workspace').filter({ visible: true })).toContainText(`合成回答${localTask.n}`);
  await screenshot(page, 'local-running');
  assert.equal(databaseTask(local.instance, localTask.id).state, 'running');
  record('actual local Electron owns exactly packaged Node web/MCP workers and persists running partial to SQLite');
  await localObserver.context().close(); await pause(15000);
  const beforeStop = streams, closingAt = Date.now(); await closeApp();
  await until(() => active, n => n === 0);
  for (const worker of workers) assert.throws(() => process.kill(worker.ProcessId, 0));
  assert.equal(await fetch(localBase, { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false), false);
  assert.equal(await fs.stat(path.join(local.instance, 'data/.instance-operation.lock')).catch(() => null), null);
  report.localOffline = databaseTask(local.instance, localTask.id); assert.ok(report.localOffline.partial.includes(`合成回答${localTask.n}`));
  report.delayedLocalExit = { heldMs: 15000, cleanupMs: Date.now() - closingAt, active };
  record('normal local window close stops both workers and upstream model, releases instance lock, retains partial on disk');
  await launch(localProfile); page = await workspace(); await qa(page, localTask.sessionId);
  const interrupted = await until(() => task(page, localTask.id), t => t.state === 'interrupted');
  await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText(`合成回答${localTask.n}`);
  await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText(interrupted.error);
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('study-log-theme', 'dark')); await page.reload();
  await expect(page.locator('.rag-workspace').filter({ visible: true })).toContainText(interrupted.error);
  await screenshot(page, 'local-reopened-interrupted-dark');
  const reopenedBase = new URL(page.url()).origin + '/study-log', recovered = await independent(reopenedBase, local.password, localTask.sessionId);
  await expect(recovered.locator('.rag-workspace').filter({ visible: true })).toContainText(interrupted.error);
  await pause(2500); assert.equal(streams, beforeStop); assert.equal(active, 0); assert.equal(interrupted.result, null);
  const sessionResponse = await api(recovered, `/rag/sessions/${localTask.sessionId}`); assert.equal(sessionResponse.status, 404);
  report.localTask = { ...localTask, state: interrupted.state, partial: interrupted.partial, error: interrupted.error, autoReplayed: false, savedAsSuccess: false };
  record('reopening local candidate and independent browser shows interrupted partial, does not replay model or save a success');
  await recovered.context().close(); await closeApp();
  for (const instance of [remote, local]) assert.equal(await fs.readFile(instance.sourceFile, 'utf8'), source);
  assert.equal(report.requests.some(r => /\/rag\/sessions(?:\/[^/]+)?$/.test(r.path) && ['POST', 'PUT'].includes(r.method)), false);
  assert.deepEqual(report.errors, []);
  record('synthetic sources unchanged, no task-path client session POST/PUT, no renderer errors or paid calls');
} catch (error) {
  report.failure = error.stack || String(error); console.error(report.failure); throw error;
} finally {
  if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await closeApp().catch(error => { report.cleanupError = String(error); }); }
  await browser?.close();
  for (const manager of managers) await manager.shutdown();
  for (const res of pending.values()) res.destroy(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root);
}

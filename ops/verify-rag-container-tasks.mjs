import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { parseEnv, promisify } from 'node:util';
import { execFile } from 'node:child_process';

// Fresh synthetic Compose project only. Models stay inside this project's network.
const repo = path.resolve(import.meta.dirname, '..'), stamp = Date.now();
const project = `public-f08-tasks-${stamp}`, root = path.join(repo, '.local', project);
await fs.mkdir(root, { recursive: true });
const freePort = async () => { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; };
const port = await freePort(), modelPort = await freePort(), base = `http://127.0.0.1:${port}/study-log`;
const report = { root, project, checks: [], images: {}, requests: [], errors: [], paidModelCalls: 0 };
const mark = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 45000) { const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(100); } }
const environment = { ...process.env, INSTANCE_PARENT: root, INSTANCE_ROOT: path.join(root, 'source'), WEB_PORT: String(port),
  WEB_IMAGE: process.env.F08_WEB_IMAGE || 'study-log-public-web:f08-tasks-20261018',
  TOOLS_IMAGE: process.env.F08_TOOLS_IMAGE || 'study-log-public-tools:f08-tasks-20261018',
  MCP_IMAGE: process.env.F08_MCP_IMAGE || 'study-log-public-mcp:0.1.2' };
const oldImage = process.env.F08_OLD_WEB_IMAGE || 'study-log-public-web:0.1.2', currentImage = environment.WEB_IMAGE;
const oldToolsImage = process.env.F08_OLD_TOOLS_IMAGE || 'study-log-public-tools:0.1.2';
const run = promisify(execFile), override = path.join(root, 'compose.tasks.json');
const docker = async args => (await run('docker', args, { cwd: repo, env: environment, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
const compose = args => docker(['compose', '-p', project, '-f', 'compose.yaml', '-f', override, ...args]);
const tool = code => compose(['run', '--rm', '--no-deps', 'tools', '--input-type=module', '-e', code]);
const source = '## 2026-09-01\n\n### 合成归档\n\n合成归档需要保存完整回答、来源和任务收据。\n';
let cookie = '';
async function request(route, method = 'GET', body) {
  report.requests.push({ route, method });
  const response = await fetch(base + '/api' + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
async function login() {
  await until(() => fetch(base, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false), Boolean);
  const env = parseEnv(await fs.readFile(path.join(environment.INSTANCE_ROOT, '.env'), 'utf8'));
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.APP_PASSWORD }) });
  assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0];
}
const modelState = () => fetch(`http://127.0.0.1:${modelPort}/state`).then(r => r.json());
async function finish(n) { assert.equal((await fetch(`http://127.0.0.1:${modelPort}/finish?n=${n}`, { method: 'POST' })).status, 200); }
const task = async id => { const result = await request(`/rag/tasks/${id}`); assert.equal(result.status, 200); return result.body.task; };
async function submit() {
  const result = await request('/rag/tasks', 'POST', { submissionId: randomUUID(), sessionId: randomUUID(), baseVersion: null, question: '合成归档应保留什么？', mode: 'logs_only' });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.task;
}
async function stop() { await compose(['stop', 'web', 'study-log-mcp']); }
async function start(image = currentImage, instance = 'source') {
  environment.WEB_IMAGE = image; environment.INSTANCE_ROOT = path.join(root, instance);
  await compose(['--profile', 'retrieval', 'up', '-d', '--no-build', '--force-recreate', 'web', 'study-log-mcp']); await login();
}
const inspectCode = name => `
  import fs from 'node:fs/promises'; import {createHash} from 'node:crypto'; import {DatabaseSync} from 'node:sqlite';
  const data='/instances/${name}/data', json=await fs.readFile(data+'/state/rag-sessions.json'), bytes=await fs.readFile(data+'/state/rag-tasks.sqlite');
  const hash=b=>createHash('sha256').update(b).digest('hex'), db=new DatabaseSync(data+'/state/rag-tasks.sqlite',{readOnly:true});
  const tasks=db.prepare('SELECT id,state,partial,result,save_state,fingerprint,session_id FROM tasks ORDER BY created_at,id').all();
  const worker=db.prepare('SELECT count(*) n FROM worker').get().n, leases=db.prepare('SELECT count(*) n FROM leases').get().n; db.close();
  console.log(JSON.stringify({jsonHash:hash(json),dbHash:hash(bytes),file:JSON.parse(json),tasks,worker,leases}));`;
const inspect = async name => JSON.parse(await tool(inspectCode(name)));
await fs.writeFile(path.join(root, 'model.mjs'), `
import http from 'node:http';
let streams=0,active=0; const pending=new Map();
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://model');
 if(url.pathname==='/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({streams,active}));return;}
 if(url.pathname==='/finish'){const output=pending.get(Number(url.searchParams.get('n')));if(!output){res.writeHead(404).end();return;}output.end('data: '+JSON.stringify({choices:[{delta:{content:'、来源和任务收据。[S1]'},finish_reason:'stop'}],usage:{prompt_tokens:21,completion_tokens:12}})+'\\n\\ndata: [DONE]\\n\\n');res.end('{}');return;}
 let raw='';for await(const bytes of req)raw+=bytes;const input=JSON.parse(raw);
 if(!input.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({query:'合成归档',scopeSource:null,strategy:'relevance'})},finish_reason:'stop'}],usage:{prompt_tokens:8,completion_tokens:4}}));return;}
 const n=++streams;active++;pending.set(n,res);res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'合成回答'+n+'：保留完整回答'},finish_reason:null}]})+'\\n\\n');res.once('close',()=>{active--;pending.delete(n);});
}).listen(4020,'0.0.0.0');
`);
await fs.writeFile(override, JSON.stringify({ services: {
  web: { environment: { CHAT_API_URL: 'http://model:4020/chat', CHAT_API_KEY: 'synthetic-container-model-key', CHAT_MODEL: 'synthetic-container-model', CHAT_LIGHT_MODEL: 'synthetic-container-model',
    STUDY_LOG_MCP_URL: 'http://study-log-mcp:3020/mcp', STUDY_LOG_MCP_TOKEN: 'synthetic-container-mcp-token', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } },
  'study-log-mcp': { environment: { MCP_HTTP_TOKEN: 'synthetic-container-mcp-token' } },
  model: { image: environment.TOOLS_IMAGE, init: true, entrypoint: ['node'], command: ['/model.mjs'], ports: [`127.0.0.1:${modelPort}:4020`], volumes: [{ type: 'bind', source: path.join(root, 'model.mjs'), target: '/model.mjs', read_only: true }] }
} }, null, 2));
try {
  for (const image of [currentImage, environment.TOOLS_IMAGE, environment.MCP_IMAGE, oldImage, oldToolsImage]) report.images[image] = JSON.parse(await docker(['image', 'inspect', image, '--format', '{{json .}}'])).Id;
  await compose(['run', '--rm', '--no-deps', 'tools', 'ops/instance.mjs', 'init', '/instances/source']);
  await fs.writeFile(path.join(environment.INSTANCE_ROOT, 'data/2026-09_学习日志.md'), source);
  await compose(['up', '-d', '--no-build', 'model']); await until(() => modelState().catch(() => null), Boolean);
  await start();
  const caps = await request('/capabilities'); assert.equal(caps.body.features.ragTasks.protocolVersion, 1); assert.equal(caps.body.features.ragTasks.configured, true);
  const webId = await compose(['ps', '-q', 'web']);
  report.runtime = JSON.parse(await docker(['exec', webId, 'node', '-p', 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,uid:process.getuid()})']));
  assert.equal(report.runtime.platform, 'linux'); assert.equal(report.runtime.arch, 'x64'); assert.equal(report.runtime.uid, 1000);
  mark('real Linux amd64 non-root Web/MCP containers expose a ready persistent-task protocol');
  const saved = await submit(); await until(modelState, value => value.streams === 1); await finish(1);
  await until(() => task(saved.id), value => value.state === 'succeeded' && value.saveState === 'saved');
  const running = await submit(); await until(() => task(running.id), value => value.partial.includes('合成回答2'));
  const queued = await submit(); assert.equal((await task(queued.id)).state, 'queued');
  let refused = false; try { await compose(['run', '--rm', '--no-deps', 'tools', 'ops/archive-cli.mjs', 'backup', '/instances/source', '/instances/live.slarchive']); } catch { refused = true; }
  assert.equal(refused, true); assert.equal(await fs.stat(path.join(root, 'live.slarchive')).catch(() => null), null);
  assert.equal((await task(running.id)).state, 'running'); assert.equal((await task(queued.id)).state, 'queued');
  mark('live official service lock rejects archive while one answer runs and another waits');
  await stop(); await until(modelState, value => value.active === 0);
  // Deterministic crash injection after normal stop: one JSON receipt was committed
  // before SQLite acknowledgement; one old execution/lease survived a power loss.
  await tool(`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/instances/source/data/state/rag-tasks.sqlite');
    db.prepare("UPDATE tasks SET save_state='pending' WHERE id=?").run(${JSON.stringify(saved.id)});
    db.prepare("UPDATE tasks SET state='running',owner='99999999:synthetic-old-owner' WHERE id=?").run(${JSON.stringify(running.id)});
    db.exec("DELETE FROM worker;DELETE FROM leases");
    db.prepare('INSERT INTO worker VALUES(1,?,?)').run('99999999:synthetic-old-owner',Date.now()+130000);
    db.prepare('INSERT INTO leases VALUES(?,?,?,?)').run(${JSON.stringify(running.id)},'99999999:synthetic-old-owner','task',Date.now()+130000);db.close();`);
  const before = await inspect('source'); assert.equal(before.file.taskReceipts.length, 1);
  const completeRow = before.tasks.find(value => value.id === saved.id), receipt = before.file.taskReceipts[0];
  assert.equal(receipt.taskId, saved.id); assert.equal(receipt.sessionId, completeRow.session_id); assert.equal(receipt.fingerprint, before.file.sessions[0].fingerprint);
  await compose(['run', '--rm', '--no-deps', 'tools', 'ops/archive-cli.mjs', 'backup', '/instances/source', '/instances/snapshot.slarchive']);
  report.archiveManifest = JSON.parse(await tool(`import {verifyArchive} from './ops/archive.mjs';const {manifest}=await verifyArchive('/instances/snapshot.slarchive');console.log(JSON.stringify(manifest.entries.filter(e=>['data/state/rag-sessions.json','data/state/rag-tasks.sqlite'].includes(e.path))));`));
  assert.equal(report.archiveManifest.find(value => value.path.endsWith('rag-sessions.json')).sha256, before.jsonHash);
  assert.equal(report.archiveManifest.find(value => value.path.endsWith('rag-tasks.sqlite')).sha256, before.dbHash);
  const afterBackup = await inspect('source'); assert.equal(afterBackup.jsonHash, before.jsonHash); assert.equal(afterBackup.dbHash, before.dbHash);
  mark('offline Linux archive captures exact SQLite/result and JSON/receipt bytes under one maintenance lock');
  for (const operation of [['verify', '/instances/snapshot.slarchive'], ['restore', '/instances/snapshot.slarchive', '/instances/old-tools-target']]) {
    await assert.rejects(docker(['run', '--rm', '--network', 'none', '--mount', `type=bind,source=${root},target=/instances`, oldToolsImage, 'ops/archive-cli.mjs', ...operation]), error => /ARCHIVE_INVALID/.test(error.stderr));
  }
  assert.equal(await fs.stat(path.join(root, 'old-tools-target')).catch(() => null), null);
  mark('actual old tools reject task-aware V2 archives before creating a restore target');
  await compose(['run', '--rm', '--no-deps', 'tools', 'ops/archive-cli.mjs', 'restore', '/instances/snapshot.slarchive', '/instances/restored']);
  const restored = await inspect('restored'); assert.equal(restored.jsonHash, before.jsonHash);
  for (const id of [running.id, queued.id]) assert.equal(restored.tasks.find(value => value.id === id).state, 'interrupted');
  assert.equal(restored.tasks.find(value => value.id === running.id).partial, before.tasks.find(value => value.id === running.id).partial);
  assert.equal(restored.worker, 0); assert.equal(restored.leases, 0);
  mark('restore interrupts old running/queued work, retains partial/result/JSON receipt and clears stale ownership');
  await start(currentImage, 'restored'); await until(() => task(saved.id), value => value.saveState === 'saved');
  await pause(1500); assert.deepEqual(await modelState(), { streams: 2, active: 0 });
  for (const id of [running.id, queued.id]) assert.equal((await task(id)).state, 'interrupted');
  const session = await request(`/rag/sessions/${saved.sessionId}`); assert.equal(session.status, 200); assert.equal(session.body.session.messages.length, 2);
  await stop(); const recovered = await inspect('restored'); assert.equal(recovered.jsonHash, before.jsonHash); assert.equal(recovered.file.taskReceipts.length, 1);
  report.restore = { source: { jsonHash: before.jsonHash, dbHash: before.dbHash }, restored: { jsonHash: recovered.jsonHash, dbHash: recovered.dbHash }, model: await modelState(), receiptCount: recovered.file.taskReceipts.length };
  mark('restored service reconciles JSON-before-SQLite crash exactly once without replaying either old task');

  async function oldWriterRejected(name, expected) {
    await start(oldImage, name);
    assert.equal((await request('/capabilities')).body.features.ragTasks, undefined);
    const id = randomUUID(), messages = [{ id: randomUUID(), role: 'user', content: '合成旧版写入', status: 'complete' }, { id: randomUUID(), role: 'assistant', content: '合成旧版回答', status: 'complete' }];
    const rejected = response => { assert.equal(response.status, 500); assert.equal(response.body.code, 'RAG_SESSION_STORAGE_ERROR'); };
    rejected(await request('/rag/sessions'));
    rejected(await request('/rag/sessions', 'POST', { id, mutationId: randomUUID(), baseVersion: null, answerMode: 'logs_only', messages }));
    if (expected.file.sessions[0]) {
      const oldSession = expected.file.sessions[0];
      rejected(await request(`/rag/sessions/${oldSession.id}`, 'PUT', { mutationId: randomUUID(), baseVersion: 'a'.repeat(64), answerMode: 'logs_only', messages }));
    }
    await stop(); const after = await inspect(name);
    assert.equal(after.jsonHash, expected.jsonHash); assert.equal(after.dbHash, expected.dbHash);
  }
  await oldWriterRejected('restored', recovered);
  mark('actual published 0.1.2 image refuses session reads/create/update without altering restored JSON or SQLite');
  await compose(['run', '--rm', '--no-deps', 'tools', 'ops/instance.mjs', 'init', '/instances/pending-only']);
  await fs.writeFile(path.join(root, 'pending-only/data/2026-09_学习日志.md'), source);
  await start(currentImage, 'pending-only'); const firstPending = await submit();
  await until(() => task(firstPending.id), value => value.partial.includes('合成回答3')); await stop();
  const pendingOnly = await inspect('pending-only'); assert.deepEqual(pendingOnly.file.taskReceipts, []); assert.deepEqual(pendingOnly.file.sessions, []);
  await oldWriterRejected('pending-only', pendingOnly); assert.deepEqual(await modelState(), { streams: 3, active: 0 });
  mark('old image also refuses writes before the first task succeeds, using the precommitted empty receipt format');

  await compose(['run', '--rm', '--no-deps', 'tools', 'ops/instance.mjs', 'init', '/instances/cancel-only']);
  await fs.writeFile(path.join(root, 'cancel-only/data/2026-09_学习日志.md'), source);
  await start(currentImage, 'cancel-only'); report.delayedCancel = [];
  for (const heldMs of [1000, 15000, 30000]) {
    const previous = await modelState(), cancelled = await submit();
    await until(() => task(cancelled.id), value => value.partial.length > 0);
    await pause(heldMs); const cancelledAt = Date.now();
    assert.equal((await request(`/rag/tasks/${cancelled.id}/cancel`, 'POST')).body.task.state, 'cancelled');
    const closed = await until(modelState, value => value.active === 0, 5000), cleanupMs = Date.now() - cancelledAt;
    assert.equal(closed.streams, previous.streams + 1);
    assert.equal((await request(`/rag/sessions/${cancelled.sessionId}`)).status, 404);
    const snapshot = await inspect('cancel-only'); assert.equal(snapshot.leases, 0); assert.equal(snapshot.file.sessions.length, 0);
    assert.equal(snapshot.tasks.find(value => value.id === cancelled.id).state, 'cancelled');
    report.delayedCancel.push({ heldMs, cleanupMs, active: closed.active, leases: snapshot.leases, savedSessions: snapshot.file.sessions.length });
  }
  mark('real Linux Web cancels bodies held for 1/15/30 seconds, releases upstream and leases, and never saves partial answers');
  const beforeShutdown = await modelState(), shutdownTask = await submit();
  await until(() => task(shutdownTask.id), value => value.partial.length > 0); await pause(15000);
  const stoppingAt = Date.now(); await stop(); await until(modelState, value => value.active === 0, 5000);
  const stopped = await inspect('cancel-only'); assert.equal(stopped.leases, 0);
  assert.equal(stopped.tasks.find(value => value.id === shutdownTask.id).state, 'interrupted');
  assert.equal(stopped.file.sessions.length, 0); const stoppedCalls = (await modelState()).streams;
  assert.equal(stoppedCalls, beforeShutdown.streams + 1);
  report.delayedShutdown = { heldMs: 15000, cleanupMs: Date.now() - stoppingAt, active: 0, leases: stopped.leases };
  await start(currentImage, 'cancel-only'); await pause(1500);
  assert.deepEqual(await modelState(), { streams: stoppedCalls, active: 0 });
  assert.equal((await task(shutdownTask.id)).state, 'interrupted'); await stop();
  mark('Linux graceful stop after a held body releases upstream; restart retains interruption without replay or success save');
  const sourceAfter = await inspect('source'); assert.equal(sourceAfter.jsonHash, before.jsonHash); assert.equal(sourceAfter.dbHash, before.dbHash);
  for (const name of ['source', 'restored', 'pending-only', 'cancel-only']) assert.equal(await fs.readFile(path.join(root, name, 'data/2026-09_学习日志.md'), 'utf8'), source);
  mark('all synthetic source logs unchanged; original archived instance remains unchanged after restore and downgrade probes');
} catch (error) { report.failure = error.stack || String(error); throw error; }
finally {
  report.containerStateBeforeCleanup = await compose(['ps', '-a', '--format', 'json']).catch(() => 'unavailable');
  await compose(['logs', '--no-color', 'web', 'study-log-mcp', 'model']).then(text => fs.writeFile(path.join(root, 'container.log'), text)).catch(() => {});
  await compose(['--profile', 'retrieval', '--profile', 'tools', 'down', '--remove-orphans']).catch(error => { report.cleanupError = String(error); });
  report.remainingContainers = await docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}']);
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(root);
  assert.equal(report.cleanupError, undefined); assert.equal(report.remainingContainers, '');
}

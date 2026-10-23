import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

export async function loadQaTasks(apiExports) {
  class ApiError extends Error { constructor(message, statusCode, code = '') { super(message); this.statusCode = statusCode; this.code = code; } }
  const network = apiExports || { ApiError, ApiStreamCancelledError: class extends Error {} };
  const dependencies = { '../../common/network/ApiClient': network,
    '@kit.ArkTS': { util: { generateRandomUUID: randomUUID } } };
  const load = async name => {
    const source = await readFile(new URL(`../entry/src/main/ets/features/qa/${name}.ets`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, Error, Date, JSON, setTimeout, clearTimeout, Observed: value => value,
      require(name) { if (!(name in dependencies)) throw Error(`Missing dependency: ${name}`); return dependencies[name]; } });
    dependencies[`./${name}`] = module.exports; return module.exports;
  };
  const cancellationSource = await readFile(new URL('../entry/src/main/ets/common/network/ReadCancellation.ets', import.meta.url), 'utf8');
  const cancellationModule = { exports: {} };
  runInNewContext(ts.transpileModule(cancellationSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: cancellationModule, exports: cancellationModule.exports, Error });
  dependencies['../../common/network/ReadCancellation'] = cancellationModule.exports;
  const models = await load('QaTaskModels'); await load('QaStreamParser');
  const { QaTaskClient } = await load('QaTaskClient'), { QaSessionController } = await load('QaSessionController'), { QaNavigationController } = await load('QaNavigationController');
  return { QaTaskClient, QaSessionController, QaNavigationController, ApiError: network.ApiError, ...models };
}

export function task(sessionId = randomUUID(), values = {}) {
  return { id: randomUUID(), submissionId: randomUUID(), sessionId, createdAt: '2026-10-18T01:00:00.000Z', updatedAt: '2026-10-18T01:00:00.000Z',
    revision: 1, state: 'running', saveState: 'pending', question: '合成任务问题', mode: 'logs_only', replaceLast: false,
    partial: '合成片段', stage: '合成生成', error: '', saveError: '', result: null, ...values };
}
export function session(id = randomUUID(), values = {}) {
  return { id, version: 'a'.repeat(64), createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z',
    title: '合成已保存会话', answerMode: 'logs_only', messageCount: 2, lastQuestion: '已保存问题',
    messages: [{ id: randomUUID(), role: 'user', content: '已保存问题' }, { id: randomUUID(), role: 'assistant', content: '已保存答案' }], ...values };
}
export function submission(sessionId = randomUUID()) {
  return { submissionId: randomUUID(), sessionId, baseVersion: null, question: '待确认的合成问题', mode: 'logs_only' };
}
export function qaView() { return { onSessionsChange() {}, onSessionsError() {}, onActiveSessionChange() {}, onBusyChange() {}, onPendingChange() {},
  onSessionReady() {}, onBeforeSessionChange: async () => {}, resetComposerScroll() {}, beforeSend() {}, showComposer() {}, afterFrame: action => action() }; }
export const plain = value => JSON.parse(JSON.stringify(value));

export async function fixture() {
  const runtime = await loadQaTasks(), instanceId = randomUUID(), tasks = new Map(), sessions = new Map(), requests = [], writes = [];
  const local = { raw: '[]', fail: false, read: async () => local.raw,
    write: async raw => { if (local.fail) throw Error('storage unavailable'); local.raw = raw; writes.push(raw); } };
  const transport = {
    getConnectionBinding: () => 'synthetic-connection',
    getEventStreamForInstance: (path, instance, emit, cancellation) => new Promise(resolve => cancellation.bind(resolve)),
    put: async (path, body) => {
      requests.push({ method: 'PUT', path, body: plain(body) });
      const saved = sessions.get(path.split('/').at(-1));
      if (!saved || saved.version !== body.baseVersion) throw new runtime.ApiError('会话已变化', 409);
      Object.assign(saved, { messages: plain(body.messages), version: 'b'.repeat(64) });
      return { session: plain(saved) };
    },
    get: async path => {
      if (path === '/rag/sessions') return { sessions: [...sessions.values()] };
      const result = sessions.get(path.split('/').at(-1)); if (!result) throw new runtime.ApiError('deleted session', 404);
      return { session: plain(result) };
    },
    getForInstance: async (path, instance) => {
      requests.push({ method: 'GET', path, instance });
      if (path === '/capabilities') return { instanceId, features: { ragTasks: { supported: true, configured: true, protocolVersion: 1 } } };
      if (path === '/rag/tasks' || path.startsWith('/rag/tasks?sessionId=')) return { tasks: [...tasks.values()].filter(item => !path.includes('?') || item.sessionId === decodeURIComponent(path.split('sessionId=')[1])).map(plain) };
      const value = tasks.get(path.split('/').at(-1)); if (!value) throw new runtime.ApiError('deleted task', 404);
      return { task: plain(value) };
    },
    postForInstance: async (path, body, instance) => {
      requests.push({ method: 'POST', path, body: plain(body), instance });
      if (path === '/rag/tasks') {
        let value = [...tasks.values()].find(item => item.submissionId === body.submissionId);
        if (!value) { value = task(body.sessionId, { submissionId: body.submissionId, question: body.question, replaceLast: body.replaceLast === true, editMessageId: body.editMessageId }); tasks.set(value.id, value); }
        return { task: plain(value) };
      }
      const value = tasks.get(path.split('/').at(-2)); if (!value) throw new runtime.ApiError('deleted task', 404);
      if (path.endsWith('/cancel')) { value.state = 'cancelled'; value.revision++; }
      else if (path.endsWith('/save')) { value.saveState = 'saved'; value.revision++; }
      return { task: plain(value) };
    },
    deleteForInstance: async (path, instance) => { requests.push({ method: 'DELETE', path, instance }); tasks.delete(path.split('/').at(-1)); return { removed: true }; }
  };
  const client = new runtime.QaTaskClient(transport, local, instanceId);
  return { ...runtime, instanceId, tasks, sessions, requests, writes, local, transport, client };
}

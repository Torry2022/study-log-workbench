import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }

async function loadClass(path, mock) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Observed: value => value, require: mock });
  return module.exports;
}

test('new note retry reuses one client identity after a lost response', async () => {
  let nextId = 0;
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => `00000000-0000-0000-0000-${String(++nextId).padStart(12, '0')}` } }));
  const editor = new NoteEditorSession();
  editor.startNew('2026-09-28T17:00:00+08:00');
  editor.title = '合成随记'; editor.body = '重试保持同一条';
  const firstClientId = editor.clientId;
  const remote = new Map();
  let writes = 0;
  const transport = {
    post: async (route, request) => {
      assert.equal(route, '/notes/batch');
      const item = request.notes[0];
      assert.equal(item.clientId, firstClientId);
      if (!remote.has(item.clientId)) remote.set(item.clientId, { id: item.clientId, version: 'v1' });
      if (++writes === 1) throw new ApiError('响应丢失', 502);
      return { notes: [remote.get(item.clientId)] };
    },
    get: async () => ({ notes: [...remote.values()], years: [], tags: [] })
  };
  const success = [];
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: value => success.push(value), failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  await controller.save();
  assert.equal(editor.editing, true);
  assert.equal(editor.editingId, '');
  assert.equal(remote.size, 1);
  await controller.save();
  assert.equal(remote.size, 1);
  assert.equal(editor.editingId, firstClientId);
  assert.equal(editor.editing, false);
  assert.deepEqual(success, ['随记已保存']);
  editor.startNew('2026-09-28T17:00:00+08:00');
  assert.notEqual(editor.clientId, firstClientId);
});

test('an uncertain note update reconciles only the submitted server state', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'unused' } }));
  const note = { id: 'note-1', title: '合成', body: '旧正文', insight: '', sources: [], tags: [],
    recordedAt: '2026-09-28T17:00:00+08:00', version: 'v0' };
  const editor = new NoteEditorSession(); editor.startEdit(note); editor.body = '新正文';
  let remote = note;
  const successes = [];
  const transport = {
    patch: async () => { remote = { ...note, body: '新正文', version: 'v1' }; throw new ApiError('响应丢失', 502); },
    get: async () => ({ notes: [remote], years: [], tags: [] })
  };
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: value => successes.push(value), failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  await controller.save();
  assert.equal(editor.baseVersion, 'v1');
  assert.equal(editor.editing, false);
  assert.deepEqual(successes, ['随记已更新']);

  editor.startEdit(note); editor.body = '新正文'; remote = { ...note, body: '另一客户端正文', version: 'v2' };
  transport.patch = async () => { throw new ApiError('conflict', 409); };
  await controller.save();
  assert.equal(editor.editing, true);
  assert.equal(editor.baseVersion, 'v0');
  assert.match(controller.errorMessage, /服务器随记已变化/);
  assert.deepEqual(successes, ['随记已更新']);
});

test('an uncertain note delete succeeds after the server confirms absence', async () => {
  const note = { id: 'note-1', version: 'v0' };
  let remote = [note];
  const successes = [];
  const transport = {
    delete: async () => { remote = []; throw new ApiError('响应丢失', 502); },
    get: async () => ({ notes: remote, years: [], tags: [] })
  };
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: value => successes.push(value), failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, {}, view);
  controller.notes = [note];
  await controller.deleteNote(note);
  assert.equal(controller.notes.length, 0);
  assert.equal(controller.errorMessage, '');
  assert.deepEqual(successes, ['随记已删除']);
});

test('reconciling a saved note keeps text typed after submission', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'unused' } }));
  const original = { id: 'note-1', title: '合成', body: '原文', insight: '', sources: [], tags: [],
    recordedAt: '2026-09-28T17:00:00+08:00', version: 'v0' };
  const editor = new NoteEditorSession(); editor.startEdit(original); editor.body = '已提交';
  const saved = { ...original, body: '已提交', version: 'v1' };
  let releaseRead;
  const pendingRead = new Promise(resolve => { releaseRead = resolve; });
  let reads = 0;
  const transport = { patch: async () => { throw new ApiError('响应丢失', 502); },
    get: async () => ++reads === 1 ? pendingRead : { notes: [saved], years: [], tags: [] } };
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: () => {}, failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  const saving = controller.save();
  editor.body = '提交后继续输入';
  releaseRead({ notes: [saved], years: [], tags: [] });
  await saving;
  assert.equal(editor.baseVersion, 'v1');
  assert.equal(editor.body, '提交后继续输入');
  assert.equal(editor.editing, true);
  assert.notEqual(editor.value(), editor.baseline);
});

test('an unavailable reconciliation read keeps the update draft until an explicit retry', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'unused' } }));
  const original = { id: 'note-1', title: '合成', body: '原文', insight: '', sources: [], tags: [],
    recordedAt: '2026-09-28T17:00:00+08:00', version: 'v0' };
  const editor = new NoteEditorSession(); editor.startEdit(original); editor.body = '已提交';
  const saved = { ...original, body: '已提交', version: 'v1' };
  let writes = 0, reads = 0;
  const transport = {
    patch: async () => { if (++writes === 1) throw new ApiError('响应丢失', 502); throw new ApiError('版本冲突', 409); },
    get: async () => { if (++reads === 1) throw new ApiError('核对不可用', 503); return { notes: [saved], years: [], tags: [] }; }
  };
  const successes = [];
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: value => successes.push(value), failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  await controller.save();
  assert.equal(editor.editing, true);
  assert.equal(editor.body, '已提交');
  assert.equal(editor.baseVersion, 'v0');
  assert.match(controller.errorMessage, /响应丢失/);
  assert.deepEqual(successes, []);
  await controller.save();
  assert.equal(editor.editing, false);
  assert.equal(editor.baseVersion, 'v1');
  assert.deepEqual(successes, ['随记已更新']);
  assert.equal(writes, 2);
});

test('an unavailable reconciliation read leaves a deleted note visible until retry', async () => {
  const note = { id: 'note-1', version: 'v0' };
  let writes = 0, reads = 0;
  const transport = {
    delete: async () => { if (++writes === 1) throw new ApiError('响应丢失', 502); throw new ApiError('已不存在', 404); },
    get: async () => { if (++reads === 1) throw new ApiError('核对不可用', 503); return { notes: [], years: [], tags: [] }; }
  };
  const successes = [];
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => {}, success: value => successes.push(value), failure: () => {} };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, {}, view);
  controller.notes = [note];
  await controller.deleteNote(note);
  assert.equal(controller.notes.length, 1);
  assert.match(controller.errorMessage, /响应丢失/);
  assert.deepEqual(successes, []);
  await controller.deleteNote(note);
  assert.equal(controller.notes.length, 0);
  assert.deepEqual(successes, ['随记已删除']);
  assert.equal(writes, 2);
});

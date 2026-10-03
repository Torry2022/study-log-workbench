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

test('refreshing remote notes leaves the current editor draft intact', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'draft-id' } }));
  const editor = new NoteEditorSession();
  editor.startNew('2026-09-30T10:00:00+08:00');
  editor.title = '未保存标题'; editor.body = '未保存正文';
  const remote = { id: 'remote-id', title: '另一设备的随记', body: '合成资料',
    year: '2026', tags: [], sources: [], insight: '', recordedAt: '2026-09-30T10:00:00+08:00' };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController({ get: async () => ({ notes: [remote], years: [], tags: [] }) }, editor,
    { navigationChanged() {}, loaded() {} });
  await controller.load();
  assert.equal(controller.notes[0].id, remote.id);
  assert.equal(editor.title, '未保存标题');
  assert.equal(editor.body, '未保存正文');
  assert.equal(editor.editing, true);
});

test('leaving a pending new note isolates its outcome without losing a committed record on refresh', async () => {
  for (const leave of ['new-editor', 'dispose']) {
    for (const outcome of ['success', 'lost-response', 'not-written']) {
      let nextId = 0, resolve, reject, writes = 0;
      const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
        () => ({ util: { generateRandomUUID: () => `synthetic-${++nextId}` } }));
      const editor = new NoteEditorSession();
      editor.startNew('2026-09-28T17:00:00+08:00');
      editor.title = '提交中的随记'; editor.body = '合成正文';
      const submittedId = editor.clientId;
      const remote = [];
      const transport = {
        post: (route, request) => {
          writes += 1;
          assert.equal(route, '/notes/batch');
          assert.equal(request.notes[0].clientId, submittedId);
          if (outcome !== 'not-written') remote.push({ ...request.notes[0], id: submittedId,
            version: 'v1', year: '2026', updatedAt: editor.recordedAt });
          return new Promise((yes, no) => { resolve = yes; reject = no; });
        },
        get: async () => ({ notes: remote, years: [], tags: [] })
      };
      const events = [];
      const view = { blocked: () => false, uploading: () => false,
        navigationChanged: () => events.push('navigation'), loaded: () => events.push('loaded'),
        success: () => events.push('success'), failure: () => events.push('failure') };
      const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
        () => ({ ApiError }));
      const controller = new NotesController(transport, editor, view);
      const pending = controller.save();
      if (leave === 'dispose') controller.dispose();
      editor.startNew('2026-09-28T18:00:00+08:00');
      editor.body = '另一份未保存草稿';
      const replacementId = editor.clientId;
      controller.errorMessage = '当前编辑状态';
      if (outcome === 'success') resolve({ notes: remote });
      else reject(new ApiError('旧请求失败', 502));
      await pending;
      assert.equal(editor.clientId, replacementId);
      assert.notEqual(editor.clientId, submittedId);
      assert.equal(editor.body, '另一份未保存草稿');
      assert.equal(editor.editingId, '');
      assert.equal(editor.editing, true);
      assert.equal(controller.errorMessage, '当前编辑状态');
      assert.equal(controller.saving, false);
      assert.deepEqual(events, []);
      assert.equal(writes, 1, 'an obsolete create must not be retried automatically');

      const active = leave === 'dispose' ? new NotesController(transport, editor, view) : controller;
      await active.load();
      assert.equal(active.notes.length, outcome === 'not-written' ? 0 : 1);
      if (active.notes.length) assert.equal(active.notes[0].id, submittedId);
      assert.equal(editor.body, '另一份未保存草稿');
      assert.equal(editor.clientId, replacementId);
      assert.equal(writes, 1, 'refresh must read back without creating a duplicate');
      assert.deepEqual(events, ['navigation', 'loaded']);
    }
  }
});

test('server future-time rejection preserves new and existing drafts until an explicit corrected retry', async () => {
  const { normalizeNoteRecordedAt } = await import('../../study-log-web/lib/notes-markdown.ts');
  const { beijingNoteTimestamp } = await loadClass('../entry/src/main/ets/features/notes/NoteTime.ets',
    () => assert.fail('unexpected time dependency'));
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'synthetic-clock-id' } }));
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  for (const existing of [false, true]) {
    const editor = new NoteEditorSession();
    const past = beijingNoteTimestamp(Date.now() - 3600000);
    let remote = existing ? { id: 'existing-note', version: 'v1', title: '旧标题', body: '旧正文',
      insight: '', sources: [], tags: [], recordedAt: past } : undefined;
    if (existing) editor.startEdit(remote); else editor.startNew(past);
    editor.title = '合成时钟偏差'; editor.body = '时间被拒绝后仍需保留的草稿';
    editor.recordedAt = beijingNoteTimestamp(Date.now() + 12 * 60000);
    const snapshot = editor.value(), baseline = editor.baseline, identity = editor.clientId;
    let requests = 0, reads = 0;
    const successes = [];
    const write = async (item) => {
      requests++;
      try { normalizeNoteRecordedAt(item.recordedAt); }
      catch (error) { throw new ApiError(error.message, 400); }
      remote = { ...item, id: existing ? 'existing-note' : item.clientId, version: 'v2' };
      return remote;
    };
    const transport = {
      post: async (_, request) => ({ notes: [await write(request.notes[0])] }),
      patch: async (_, request) => ({ note: await write(request) }),
      get: async () => { reads++; return { notes: remote ? [remote] : [], years: [], tags: [] }; }
    };
    const controller = new NotesController(transport, editor, { blocked: () => false,
      uploading: () => false, navigationChanged: () => {}, loaded: () => {},
      success: value => successes.push(value), failure: () => {} });
    await controller.save();
    assert.equal(controller.errorMessage, '不能创建未来时间的随记');
    assert.equal(controller.saving, false);
    assert.equal(editor.editing, true);
    assert.equal(editor.value(), snapshot);
    assert.equal(editor.baseline, baseline);
    assert.equal(editor.clientId, identity);
    assert.equal(editor.baseVersion, existing ? 'v1' : '');
    assert.equal(remote?.body, existing ? '旧正文' : undefined);
    assert.equal(requests, 1); assert.equal(reads, 0); assert.deepEqual(successes, []);
    editor.recordedAt = past;
    await controller.save();
    assert.equal(requests, 2); assert.equal(reads, 1);
    assert.equal(editor.editing, false);
    assert.equal(remote.body, '时间被拒绝后仍需保留的草稿');
    assert.equal(remote.recordedAt, past);
    assert.deepEqual(successes, [existing ? '随记已更新' : '随记已保存']);
  }
});

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
  let finishOldRead;
  const oldRead = new Promise(resolve => { finishOldRead = () => resolve({ notes: [note], years: [], tags: [] }); });
  let reads = 0;
  transport.get = async () => ++reads === 1 ? oldRead : { notes: [remote], years: [], tags: [] };
  const pendingLoad = controller.load();
  await controller.save();
  finishOldRead(); await pendingLoad;
  assert.equal(editor.editing, true);
  assert.equal(editor.baseVersion, 'v0');
  assert.match(controller.errorMessage, /服务器随记已变化/);
  assert.equal(editor.body, '新正文');
  assert.equal(controller.notes[0].body, '另一客户端正文');
  editor.startEdit(controller.notes[0]);
  assert.equal(editor.body, '另一客户端正文');
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

test('a successful note update remains visible when its follow-up list refresh fails', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => 'unused' } }));
  const original = { id: 'note-1', title: '合成', body: '原文', insight: '', sources: [], tags: [],
    recordedAt: '2026-09-28T17:00:00+08:00', updatedAt: '2026-09-28T17:00:00+08:00', year: '2026', version: 'v0' };
  const saved = { ...original, body: '已保存', updatedAt: '2026-09-28T18:00:00+08:00', version: 'v1' };
  const editor = new NoteEditorSession(); editor.startEdit(original); editor.body = '已保存';
  let visible = [];
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => { visible = controller.notes.map(note => note.body); }, success: () => {}, failure: () => {} };
  const transport = { patch: async () => ({ note: saved }), get: async () => { throw new ApiError('读取失败', 503); } };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  controller.notes = [original];
  await controller.save();
  assert.equal(editor.editing, false);
  assert.equal(visible.join(','), '已保存');
  assert.equal(controller.loadFailed, true);
});

test('a new note and its navigation facet remain visible when follow-up refresh fails', async () => {
  const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
    () => ({ util: { generateRandomUUID: () => '00000000-0000-0000-0000-000000000001' } }));
  const editor = new NoteEditorSession(); editor.startNew('2026-09-28T17:00:00+08:00');
  editor.title = '新随记'; editor.body = '合成正文'; editor.tagsText = '合成标签';
  const saved = { id: editor.clientId, title: editor.title, displayTitle: editor.title, body: editor.body,
    insight: '', sources: [], tags: ['合成标签'], recordedAt: editor.recordedAt,
    createdAt: editor.recordedAt, updatedAt: editor.recordedAt, year: '2026', version: 'v1' };
  let visible = [], years = [], tags = [];
  const view = { blocked: () => false, uploading: () => false,
    navigationChanged: (nextYears, nextTags) => { years = nextYears; tags = nextTags; },
    loaded: () => { visible = controller.notes.map(note => note.id); }, success: () => {}, failure: () => {} };
  const transport = { post: async () => ({ notes: [saved] }), get: async () => { throw new ApiError('读取失败', 503); } };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, editor, view);
  await controller.save();
  assert.equal(editor.editing, false);
  assert.equal(visible.join(','), saved.id);
  assert.equal(years[0].value, '2026');
  assert.equal(years[0].count, 1);
  assert.equal(tags[0].value, '合成标签');
  assert.equal(controller.loadFailed, true);
});

test('a successful note delete removes the old card when its follow-up list refresh fails', async () => {
  const note = { id: 'note-1', version: 'v0', tags: [], year: '2026' };
  let visible = [], loaded = 0;
  const view = { blocked: () => false, uploading: () => false, navigationChanged: () => {},
    loaded: () => { loaded += 1; visible = controller.notes.map(item => item.id); }, success: () => {}, failure: () => {} };
  const transport = { delete: async () => ({ ok: true }), get: async () => { throw new ApiError('读取失败', 503); } };
  const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
    () => ({ ApiError }));
  const controller = new NotesController(transport, {}, view);
  controller.notes = [note];
  await controller.deleteNote(note);
  assert.deepEqual(visible, []);
  assert.equal(loaded, 1);
  assert.equal(controller.notes.length, 0);
  assert.equal(controller.loadFailed, true);
});


test('late uncertain note reconciliation cannot publish errors into a replacement editor or disposed view', async () => {
  for (const operation of ['save', 'delete']) {
    for (const readFails of [false, true]) {
      const { NoteEditorSession } = await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',
        () => ({ util: { generateRandomUUID: () => 'replacement' } }));
      const note = { id: 'note-1', title: '合成', body: '旧正文', insight: '', sources: [], tags: [],
        recordedAt: '2026-09-28T17:00:00+08:00', version: 'v0' };
      const editor = new NoteEditorSession(); editor.startEdit(note); editor.body = '提交正文';
      let resolve, reject;
      const transport = {
        patch: async () => { throw new ApiError('旧更新错误', 502); },
        delete: async () => { throw new ApiError('旧删除错误', 502); },
        get: () => new Promise((yes, no) => { resolve = yes; reject = no; })
      };
      const view = { blocked: () => false, uploading: () => false, navigationChanged() {}, loaded() {},
        success() { assert.fail('obsolete success'); }, failure() { assert.fail('obsolete failure'); } };
      const { NotesController } = await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',
        () => ({ ApiError }));
      const controller = new NotesController(transport, editor, view);
      const pending = operation === 'save' ? controller.save() : controller.deleteNote(note);
      while (!resolve) await Promise.resolve();
      if (operation === 'save') { editor.startNew(note.recordedAt); editor.body = '另一份草稿'; }
      else controller.dispose();
      controller.errorMessage = '当前状态';
      if (readFails) reject(new ApiError('旧读取错误', 503));
      else resolve({ notes: [note], years: [], tags: [] });
      await pending;
      assert.equal(controller.errorMessage, '当前状态', operation + ':' + readFails);
      if (operation === 'save') assert.equal(editor.body, '另一份草稿');
    }
  }
});


test('new note rejects another record identity and keeps its original draft for explicit retry', async () => {
 const {NoteEditorSession}=await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',()=>({util:{generateRandomUUID:()=> 'synthetic-confirmation'}}));
 const {NotesController}=await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',()=>({ApiError}));
 const editor=new NoteEditorSession();editor.startNew('2026-02-05T12:00:00+08:00');editor.body='保留合成草稿';
 const requests=[],successes=[];let correct=false,remote;
 const transport={post:async(_,request)=>{requests.push(request.notes[0].clientId);remote={...request.notes[0],id:correct?request.notes[0].clientId:'other-record',version:'v1'};return {notes:[remote]};},get:async()=>({notes:[remote],years:[],tags:[]})};
 const view={blocked:()=>false,uploading:()=>false,navigationChanged(){},loaded(){},success:value=>successes.push(value),failure(){}};
 const controller=new NotesController(transport,editor,view);const baseline=editor.baseline;
 await controller.save();
 assert.equal(editor.editing,true);assert.equal(editor.editingId,'');assert.equal(editor.baseline,baseline);assert.equal(editor.body,'保留合成草稿');assert.equal(controller.errorMessage,'未能确认保存结果，草稿仍保留，请重试');assert.deepEqual(successes,[]);
 correct=true;await controller.save();assert.deepEqual(requests,['synthetic-confirmation','synthetic-confirmation']);assert.equal(editor.editing,false);assert.equal(editor.editingId,'synthetic-confirmation');assert.equal(successes.length,1);
});


test('editing a note rejects another record identity without replacing its id, baseline or version', async () => {
 const {NoteEditorSession}=await loadClass('../entry/src/main/ets/features/notes/NoteEditorSession.ets',()=>({util:{generateRandomUUID:()=> 'unused'}}));
 const {NotesController}=await loadClass('../entry/src/main/ets/features/notes/NotesController.ets',()=>({ApiError}));
 const original={id:'edited-note',version:'v1',title:'合成标题',body:'原正文',insight:'',sources:[],tags:[],recordedAt:'2026-02-05T12:00:00+08:00'};
 const editor=new NoteEditorSession();editor.startEdit(original);editor.body='应当保留的修改';
 const requests=[],successes=[];let correct=false,remote;
 const transport={patch:async(_,request)=>{requests.push({id:request.id,baseVersion:request.baseVersion});remote={...request,id:correct?request.id:'other-record',version:'v2'};return {note:remote};},get:async()=>({notes:[remote],years:[],tags:[]})};
 const view={blocked:()=>false,uploading:()=>false,navigationChanged(){},loaded(){},success:value=>successes.push(value),failure(){}};
 const controller=new NotesController(transport,editor,view);const baseline=editor.baseline;
 await controller.save();
 assert.equal(editor.editing,true);assert.equal(editor.editingId,'edited-note');assert.equal(editor.baseVersion,'v1');assert.equal(editor.baseline,baseline);assert.equal(editor.body,'应当保留的修改');assert.deepEqual(successes,[]);
 correct=true;await controller.save();assert.deepEqual(requests,[{id:'edited-note',baseVersion:'v1'},{id:'edited-note',baseVersion:'v1'}]);assert.equal(editor.editing,false);assert.equal(editor.editingId,'edited-note');assert.equal(editor.baseVersion,'v2');assert.equal(successes.length,1);
});

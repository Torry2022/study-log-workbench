import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/features/notes/components/NoteCandidateExtractor.ets', import.meta.url), 'utf8');
function subject() {
  const names = ['aboutToDisappear', 'extract', 'saveSelected', 'current'];
  const methods = names.map(name => {
    const match = new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm').exec(source);
    assert.ok(match, name);
    const end = source.slice(match.index + 1).search(/^  (?:private |aboutTo|@Builder|build\()/m);
    return source.slice(match.index, match.index + 1 + end);
  }).join('\n');
  const activeInstance = { revision: 1, capabilities: { features: { aiNoteExtraction: { configured: true } } } };
  const calls = [], busy = [], module = { exports: {} };
  let release, reject;
  const gate = new Promise((yes, no) => { release = yes; reject = no; });
  const apiClient = {
    postFiles: async () => { calls.push('upload'); return gate; },
    post: async route => { calls.push(route); return gate; }
  };
  class ApiError extends Error {}
  runInNewContext(ts.transpileModule(`export class Panel { ${methods} }`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText, { module, exports: module.exports, activeInstance, ApiError,
    fileIo: { unlinkSync() {} }, UploadFile: class { constructor(file) { this.path = file.path; } },
    CandidateNote: class { constructor(draft) { this.clientId = draft.id; } }, CandidateBatch: class { constructor(notes) { this.notes = notes; } },
    apiClient });
  const panel = new module.exports.Panel();
  Object.assign(panel, { lifecycleRevision: 0, files: [{ path: 'synthetic-a' }, { path: 'synthetic-b' }],
    drafts: [{ id: 'candidate', body: '合成', selected: true }], loading: false, saving: false,
    onBusyChange: value => busy.push(value), onSaved: () => calls.push('saved'), newTags: () => [],
    toDraft: value => value, values: () => [] });
  return { panel, activeInstance, calls, busy, release, reject, apiClient };
}

test('current candidate extraction preserves file order, results and busy completion', async () => {
  const h = subject();
  h.apiClient.postFiles = async (_route, files) => ({ document: { text: files[0].path } });
  h.apiClient.post = async (route, request) => {
    assert.equal(route, '/notes/candidates');
    assert.equal(request.documents.map(item => item.text).join(','), 'synthetic-a,synthetic-b');
    return { result: { candidates: [{ id: 'new-result' }], warnings: [],
      documents: [{ sectionCount: 1 }, { sectionCount: 2 }], model: 'synthetic' } };
  };
  await h.panel.extract();
  assert.equal(h.panel.activeId, 'new-result');
  assert.equal(h.panel.resultSummary, '2 个文件 · 3 个内容区段 · synthetic');
  assert.equal(h.panel.loading, false);
  assert.deepEqual(h.busy, [true, false]);
});

test('late candidate model result or error cannot replace a closed review', async () => {
  for (const failed of [false, true]) {
    const h = subject();
    h.apiClient.postFiles = async () => ({ document: { text: 'synthetic' } });
    const pending = h.panel.extract();
    while (!h.calls.includes('/notes/candidates')) await Promise.resolve();
    h.panel.aboutToDisappear();
    h.panel.message = 'new state';
    if (failed) h.reject(new Error('old error'));
    else h.release({ result: { candidates: [{ id: 'late' }], warnings: [], documents: [], model: 'synthetic' } });
    await pending;
    assert.equal(h.panel.drafts[0].id, 'candidate');
    assert.equal(h.panel.message, 'new state');
    assert.deepEqual(h.busy, [true]);
  }
});

for (const invalidate of ['unmount', 'instance']) {
  test(`candidate upload cannot continue into another context after ${invalidate}`, async () => {
    const h = subject();
    const pending = h.panel.extract();
    assert.deepEqual(h.calls, ['upload']);
    if (invalidate === 'unmount') h.panel.aboutToDisappear(); else h.activeInstance.revision++;
    const count = h.busy.length;
    h.release({ document: { text: 'old' } });
    await pending;
    assert.deepEqual(h.calls, ['upload'], 'do not upload remaining files or invoke a model in the new context');
    assert.equal(h.busy.length, count, 'old finally cannot change new parent busy state');
  });
  test(`candidate save cannot publish completion after ${invalidate}`, async () => {
    const h = subject();
    const pending = h.panel.saveSelected();
    if (invalidate === 'unmount') h.panel.aboutToDisappear(); else h.activeInstance.revision++;
    const count = h.busy.length;
    h.release({ notes: [] });
    await pending;
    assert.deepEqual(h.calls, ['/notes/batch']);
    assert.equal(h.busy.length, count);
  });
}


test('candidate save retains drafts for incomplete or mismatched confirmations and retries the same identities', async () => {
 for(const response of [{notes:[]},{notes:[{id:'other'}]},{notes:[{id:'candidate'},{id:'extra'}]},{notes:[null]},{}]) {
  const h=subject(); const requests=[];
  h.apiClient.post=async (_route,request)=>{requests.push(request.notes.map(note=>note.clientId));return response;};
  await h.panel.saveSelected();
  assert.equal(h.calls.includes('saved'),false);
  assert.equal(h.panel.drafts[0].id,'candidate');
  assert.equal(h.panel.drafts[0].body,'合成');
  assert.equal(h.panel.saving,false);assert.equal(h.panel.message,'未能确认保存结果，候选仍保留，请重试');
  h.apiClient.post=async (_route,request)=>{requests.push(request.notes.map(note=>note.clientId));return {notes:[{id:'candidate'}]};};
  await h.panel.saveSelected();
  assert.deepEqual(requests.map(ids=>Array.from(ids)),[['candidate'],['candidate']]);
  assert.deepEqual(h.calls,['saved']);
 }
});


test('candidate batch confirmation checks every selected identity in request order', async () => {
 for(const ids of [['second','candidate'],['candidate','candidate'],['candidate','second']]){
  const h=subject();h.panel.drafts.push({id:'second',body:'第二条',selected:true});
  h.apiClient.post=async()=>({notes:ids.map(id=>({id}))});
  await h.panel.saveSelected();
  assert.equal(h.calls.includes('saved'),ids[0]==='candidate'&&ids[1]==='second');
  assert.equal(h.panel.drafts.length,2);assert.equal(h.panel.saving,false);
 }
});

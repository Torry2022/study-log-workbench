import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const initial = () => ({ domains: ['其他'], mappings: {}, updatedAt: null, version: null });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function controller(transport, changed = () => {}) {
  const source = await readFile(new URL('../entry/src/main/ets/features/stats/TaxonomyController.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Observed: value => value,
    require() { return { ApiError }; } });
  return new module.exports.TaxonomyController(transport, changed);
}

test('taxonomy keeps public defaults and writes the version returned by the server', async () => {
  const writes = [];
  const c = await controller({ get: async () => ({ taxonomy: initial(), catalog: [] }),
    put: async (path, body) => { writes.push({ path, body }); return { taxonomy: { ...body, version: 'v1', updatedAt: null } }; } });
  await c.load();
  assert.deepEqual(Array.from(c.taxonomy.domains), ['其他']);
  c.addDomain('  测试领域  '); c.updateMapping('并发控制', '测试领域');
  assert.equal(await c.save(), true);
  assert.equal(writes[0].path, '/taxonomy'); assert.equal(writes[0].body.baseVersion, null);
  assert.equal(c.hasChanges(), false);
  c.removeDomain('测试领域'); assert.equal(c.taxonomy.mappings['并发控制'], '其他');
  c.removeDomain('其他'); assert.deepEqual(Array.from(c.taxonomy.domains), ['其他']);
  await c.save(); assert.equal(writes[1].body.baseVersion, 'v1');
});

test('taxonomy conflict preserves edits and blocks blind retries until explicit reload', async () => {
  let writes = 0;
  const c = await controller({ get: async () => ({ taxonomy: initial(), catalog: [] }),
    put: async () => { writes++; throw new ApiError('conflict', 409); } });
  await c.load(); c.addDomain('本机草稿');
  assert.equal(await c.save(), false); assert.equal(c.conflict, true);
  assert.equal(c.hasChanges(), true); assert.ok(c.taxonomy.domains.includes('本机草稿'));
  await c.save(); assert.equal(writes, 1);
  await c.load(); assert.equal(c.conflict, false); assert.equal(c.hasChanges(), false);
});

test('taxonomy restores an expired-session draft only against its original server version', async () => {
  let server = { ...initial(), version: 'v1' }; let writes = 0;
  const c = await controller({ get: async () => ({ taxonomy: server, catalog: [] }),
    put: async () => { writes++; return { taxonomy: server }; } });
  await c.load();
  const draft = { namespace: 'instance-a', taxonomy: { ...initial(), domains: ['本机领域', '其他'], version: 'v1' },
    baseVersion: 'v1', domainDraft: '', suggestions: [] };
  c.restoreDraft(draft);
  assert.equal(c.hasChanges(), true);
  assert.equal(c.conflict, false);
  assert.ok(c.taxonomy.domains.includes('本机领域'));

  server = { ...initial(), domains: ['另一客户端', '其他'], version: 'v2' };
  await c.load(); c.restoreDraft(draft);
  assert.equal(c.conflict, true);
  assert.ok(c.taxonomy.domains.includes('本机领域'));
  assert.equal(await c.save(), false);
  assert.equal(writes, 0);
});

test('taxonomy network failure retains edits and retry uses the same base version', async () => {
  let calls = 0;
  const c = await controller({ get: async () => ({ taxonomy: { ...initial(), version: 'base' }, catalog: [] }),
    put: async (_path, body) => { assert.equal(body.baseVersion, 'base');
      if (++calls === 1) throw new Error('offline');
      return { taxonomy: { ...initial(), domains: body.domains, version: 'saved' } }; } });
  await c.load(); c.addDomain('草稿');
  await c.save(); assert.equal(c.hasChanges(), true); assert.equal(c.busy, false);
  assert.equal(await c.save(), true); assert.equal(c.hasChanges(), false);
});

test('taxonomy confirms a completed write after its response is lost', async () => {
  let server = initial(); let writes = 0;
  const c = await controller({ get: async () => ({ taxonomy: server, catalog: [] }),
    put: async (_path, body) => { writes++;
      server = { domains: body.domains, mappings: body.mappings, updatedAt: 'now', version: 'v1' };
      throw new ApiError('response lost', 502);
    } });
  await c.load(); c.addDomain('合成领域');
  assert.equal(await c.save(), true);
  assert.equal(writes, 1);
  assert.equal(c.taxonomy.version, 'v1');
  assert.equal(c.hasChanges(), false);
  assert.equal(c.conflict, false);
});

test('taxonomy retries an unknown write after the first reconciliation read also fails', async () => {
  let server = initial(); let writes = 0; let reads = 0;
  const c = await controller({ get: async () => { reads++;
      if (reads === 2) throw new ApiError('offline', 503);
      return { taxonomy: server, catalog: [] };
    },
    put: async (_path, body) => { writes++;
      if (writes === 1) { server = { domains: body.domains, mappings: body.mappings,
        updatedAt: 'now', version: 'v1' }; throw new ApiError('response lost', 502); }
      throw new ApiError('conflict', 409);
    } });
  await c.load(); c.addDomain('合成领域');
  assert.equal(await c.save(), false);
  assert.equal(c.hasChanges(), true);
  assert.equal(await c.save(), true);
  assert.equal(writes, 2);
  assert.equal(c.taxonomy.version, 'v1');
  assert.equal(c.hasChanges(), false);
});

test('taxonomy keeps local edits when another client saved different content', async () => {
  let server = initial();
  const c = await controller({ get: async () => ({ taxonomy: server, catalog: [] }),
    put: async () => { server = { domains: ['另一客户端', '其他'], mappings: {},
      updatedAt: 'now', version: 'v2' }; throw new ApiError('response lost', 502); }
  });
  await c.load(); c.addDomain('本机草稿');
  assert.equal(await c.save(), false);
  assert.equal(c.conflict, true);
  assert.equal(c.hasChanges(), true);
  assert.ok(c.taxonomy.domains.includes('本机草稿'));
});

test('taxonomy disables mutations during save and ignores completion after page disposal', async () => {
  const pending = deferred(); let changes = 0;
  const c = await controller({ get: async () => ({ taxonomy: initial(), catalog: [] }), put: () => pending.promise }, () => changes++);
  await c.load(); c.addDomain('原稿'); const saving = c.save();
  c.addDomain('迟到'); c.updateMapping('标签', '其他'); c.removeDomain('原稿');
  assert.deepEqual(Array.from(c.taxonomy.domains), ['原稿', '其他']);
  assert.equal(Object.keys(c.taxonomy.mappings).length, 0);
  c.dispose(); const atClose = changes;
  pending.resolve({ taxonomy: { ...initial(), version: 'late' } });
  assert.equal(await saving, false); assert.equal(changes, atClose); assert.equal(c.taxonomy.version, null);
});

test('taxonomy late load cannot update a disposed page', async () => {
  const pending = deferred(); let changes = 0;
  const c = await controller({ get: () => pending.promise }, () => changes++);
  const loading = c.load(); c.dispose(); const atClose = changes;
  pending.resolve({ taxonomy: initial(), catalog: [] });
  assert.equal(await loading, false); assert.equal(changes, atClose);
});

test('taxonomy suggestions are reviewed before they enter the versioned draft', async () => {
  const saved = { domains: ['技术', '其他'], mappings: {}, updatedAt: null, version: 'v1' };
  const calls = [];
  const c = await controller({
    get: async () => ({ taxonomy: saved, catalog: [{ tag: 'FIFO', sources: ['队列'], months: ['2026-02'], count: 1 }] }),
    post: async (path, body) => { calls.push({ path, body }); return {
      snapshotVersion: 'v1', warnings: [], suggestions: [{ tag: 'FIFO', domain: '技术' }, { tag: 'other', domain: '技术' }]
    }; },
    put: async (_path, body) => ({ taxonomy: { ...saved, mappings: body.mappings, version: 'v2' } })
  });
  await c.load();
  await c.requestSuggestions(c.catalog);
  assert.equal(calls[0].path, '/taxonomy/suggest');
  assert.equal(calls[0].body.items[0].tag, 'FIFO');
  assert.equal(c.suggestions.length, 1);
  assert.equal(c.hasChanges(), false);
  assert.equal(await c.save(), false);
  c.updateSuggestion('FIFO', '技术', false);
  assert.equal(await c.applySuggestions(), false);
  c.updateSuggestion('FIFO', '技术', true);
  assert.equal(await c.applySuggestions(), true);
  assert.equal(c.taxonomy.mappings.FIFO, '技术');
  assert.equal(c.savedTaxonomy.mappings.FIFO, undefined);
  assert.equal(await c.save(), true);
  assert.equal(c.savedTaxonomy.version, 'v2');
});

test('taxonomy suggestion rejects changed server version and late response after a manual edit', async () => {
  const saved = { domains: ['技术', '其他'], mappings: {}, updatedAt: null, version: 'v1' };
  const item = { tag: 'FIFO', sources: ['队列'], months: ['2026-02'], count: 1 };
  const c = await controller({ get: async () => ({ taxonomy: saved, catalog: [item] }),
    post: async () => ({ snapshotVersion: 'v2', warnings: [], suggestions: [{ tag: 'FIFO', domain: '技术' }] }) });
  await c.load(); await c.requestSuggestions([item]);
  assert.equal(c.suggestions.length, 0);
  assert.match(c.suggestionMessage, /版本已变化/);

  const pending = deferred();
  const late = await controller({ get: async () => ({ taxonomy: saved, catalog: [item] }), post: () => pending.promise });
  await late.load(); const request = late.requestSuggestions([item]);
  late.updateMapping('FIFO', '技术');
  pending.resolve({ snapshotVersion: 'v1', warnings: [], suggestions: [{ tag: 'FIFO', domain: '技术' }] });
  await request;
  assert.equal(late.suggestions.length, 0);
  assert.equal(late.taxonomy.mappings.FIFO, '技术');
});

test('taxonomy suggestion application rechecks the server and preserves the local draft on conflict', async () => {
  const saved = { domains: ['技术', '其他'], mappings: {}, updatedAt: null, version: 'v1' };
  const item = { tag: 'FIFO', sources: ['队列'], months: ['2026-02'], count: 1 };
  let reads = 0;
  const c = await controller({ get: async () => ({ taxonomy: ++reads === 1 ? saved : { ...saved, version: 'v2' }, catalog: [item] }),
    post: async () => ({ snapshotVersion: 'v1', warnings: [], suggestions: [{ tag: 'FIFO', domain: '技术' }] }) });
  await c.load(); await c.requestSuggestions([item]);
  assert.equal(await c.applySuggestions(), false);
  assert.equal(c.taxonomy.mappings.FIFO, undefined);
  assert.equal(c.suggestions.length, 1);
  assert.match(c.suggestionMessage, /版本已变化/);
});

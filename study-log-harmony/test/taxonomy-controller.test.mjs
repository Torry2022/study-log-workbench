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

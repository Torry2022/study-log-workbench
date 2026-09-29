import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
async function controller(transport) {
  const source = await readFile(new URL('../entry/src/main/ets/features/favorites/FavoritesController.ets', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Observed: value => value,
    require() { return { ApiError }; } });
  return new module.exports.FavoritesController(transport);
}

test('failed favorite refresh retains results and filters until an explicit successful retry', async () => {
  let fail = false;
  let remote = { favorites: [{ id: 'one', month: '2026-01', groupIds: ['a'] }], groups: [{ id: 'a' }] };
  const c = await controller({ get: async () => {
    if (fail) throw new ApiError('synthetic unavailable', 503);
    return structuredClone(remote);
  } });
  await c.load();
  c.selectGroup('a');
  c.selectMonth('2026-01');
  fail = true;
  await c.load();
  assert.equal(c.loading, false);
  assert.equal(c.loadFailed, true);
  assert.equal(c.errorMessage, 'synthetic unavailable');
  assert.equal(c.favorites[0].id, 'one');
  assert.equal(c.selectedGroup, 'a');
  assert.equal(c.selectedMonth, '2026-01');
  fail = false;
  remote = { favorites: [], groups: [{ id: 'a' }] };
  await c.load();
  assert.equal(c.loadFailed, false);
  assert.equal(c.errorMessage, '');
  assert.equal(c.loading, false);
  assert.equal(c.favorites.length, 0);
  assert.equal(c.selectedMonth, 'all');
});

test('favorite loading rejects duplicate reads and disposed responses without replacing the snapshot', async () => {
  for (const fail of [false, true]) {
    let resolve, reject, reads = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const c = await controller({ get: () => { reads++; return pending; } });
    c.favorites = [{ id: 'kept', groupIds: [] }];
    const request = c.load();
    assert.equal(c.loading, true);
    await c.load();
    assert.equal(reads, 1);
    c.dispose();
    if (fail) reject(new ApiError('old failure', 503));
    else resolve({ favorites: [], groups: [] });
    await request;
    assert.equal(c.favorites[0].id, 'kept');
    assert.equal(c.loading, false);
    assert.equal(c.loadFailed, false);
    assert.equal(c.errorMessage, '');
  }
});

test('retrying a group creation after an uncertain response does not duplicate a reconciled group', async () => {
  const group = { id: 'group-1', name: '合成分组', order: 1, createdAt: 't1', updatedAt: 't1' };
  const remote = { favorites: [], groups: [] };
  let writes = 0;
  const c = await controller({
    get: async () => ({ favorites: remote.favorites.slice(), groups: remote.groups.slice() }),
    post: async () => {
      remote.groups = [group];
      if (++writes === 1) throw new ApiError('连接中断', 0);
      return { group };
    }
  });
  await c.load();
  assert.equal(await c.createGroup('合成分组'), '');
  await c.load();
  assert.equal(c.groups.length, 1);
  assert.equal(await c.createGroup('合成分组'), group.id);
  assert.equal(c.groups.length, 1);
  assert.equal(c.selectedGroup, group.id);
});

test('stale Harmony group editors send one membership change without replacing another client\'s groups', async () => {
  const favorite = { id: 'favorite-1', groupIds: [] };
  const remote = { favorites: [favorite], groups: [{ id: 'a' }, { id: 'b' }] };
  const requests = [];
  const transport = {
    get: async () => structuredClone(remote),
    patch: async (_path, request) => {
      requests.push(request);
      assert.equal(request.action, 'setGroup');
      assert.equal('groupIds' in request, false);
      favorite.groupIds = request.selected ? [...new Set([...favorite.groupIds, request.groupId])] :
        favorite.groupIds.filter(id => id !== request.groupId);
      return { favorite: structuredClone(favorite) };
    }
  };
  const first = await controller(transport);
  const second = await controller(transport);
  await Promise.all([first.load(), second.load()]);
  assert.equal(await first.updateGroup(favorite.id, 'a', true), true);
  assert.equal(await second.updateGroup(favorite.id, 'b', true), true);
  assert.deepEqual(favorite.groupIds, ['a', 'b']);
  assert.equal(await first.updateGroup(favorite.id, 'a', false), true);
  assert.deepEqual(favorite.groupIds, ['b']);
  assert.equal(requests.length, 3);
});

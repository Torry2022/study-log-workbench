import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { activeInstance, normalizeInstanceOrigin } from '../entry/src/main/ets/common/network/InstanceConfig.ts';

async function loadEts(name, dependencies) {
  const source = await readFile(new URL(`../entry/src/main/ets/common/storage/${name}.ets`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Error, JSON, Map, Uint8Array,
    require(name) { if (!(name in dependencies)) throw new Error(`Missing dependency: ${name}`); return dependencies[name]; }
  });
  return module.exports;
}

const firstId = '11111111-1111-1111-1111-111111111111';
const secondId = '22222222-2222-2222-2222-222222222222';

test('saved namespaces separate origin and server identity, and returning to A reuses its namespace', async () => {
  const values = new Map(); let serial = 0;
  const store = { get: async (key, fallback) => values.get(key) ?? fallback,
    put: async (key, value) => values.set(key, value), flush: async () => {} };
  const { InstanceStore } = await loadEts('InstanceStore', {
    '@kit.ArkData': { preferences: { getPreferences: async () => store } },
    '@kit.ArkTS': { util: { generateRandomUUID: () => `00000000-0000-0000-0000-${String(++serial).padStart(12, '0')}` } },
    '../network/InstanceConfig': { activeInstance, normalizeInstanceOrigin }
  });
  const instances = new InstanceStore(); await instances.initialize({});
  await instances.select('https://one.example', { instanceId: firstId }, false);
  const first = activeInstance.namespace;
  await instances.select('https://two.example', { instanceId: firstId }, false);
  const second = activeInstance.namespace;
  await instances.select('https://one.example', { instanceId: secondId }, false);
  const replacement = activeInstance.namespace;
  assert.equal(new Set([first, second, replacement]).size, 3);
  await instances.select('https://one.example', { instanceId: firstId }, false);
  assert.equal(activeInstance.namespace, first);
  assert.equal((await instances.restore()).namespace, first);
  values.set('current', '{"origin":"https://user:pass@evil.example"}');
  assert.equal(await instances.restore(), undefined);
  values.set('current', JSON.stringify({ origin: 'https://one.example', instanceId: firstId,
    namespace: '------------------------------------', localHttp: false }));
  assert.equal(await instances.restore(), undefined);
});

test('device-local token aliases do not cross instances or delayed writes', async () => {
  const values = new Map(); let release;
  const asset = { Tag: { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'return', ACCESSIBILITY: 'access', SYNC_TYPE: 'sync' },
    ReturnType: { ALL: 1 }, Accessibility: { DEVICE_FIRST_UNLOCKED: 1 }, SyncType: { NEVER: 0 },
    query: async query => values.has(String(query.get('alias'))) ? [values.get(String(query.get('alias')))] : [],
    add: async attrs => values.set(String(attrs.get('alias')), attrs),
    remove: async query => { values.delete(String(query.get('alias'))); if (release) await new Promise(resolve => release = resolve); }
  };
  const { TokenStore } = await loadEts('TokenStore', {
    '@kit.AssetStoreKit': { asset }, '@kit.ArkTS': { util: {
      TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } },
      TextDecoder: class { decodeToString(bytes) { return new TextDecoder().decode(bytes); } }
    } }, '../network/InstanceConfig': { activeInstance }
  });
  activeInstance.activate('https://one.example', 'one'); await TokenStore.write('one-token');
  activeInstance.activate('https://two.example', 'two'); assert.equal(await TokenStore.read(), '');
  await TokenStore.write('two-token');
  activeInstance.activate('https://one.example', 'one'); assert.equal(await TokenStore.read(), 'one-token');
  release = true;
  const late = TokenStore.write('late-token');
  activeInstance.activate('https://two.example', 'two');
  while (typeof release !== 'function') await Promise.resolve();
  release();
  await assert.rejects(late, /服务器连接已切换/);
  assert.equal(await TokenStore.read(), 'two-token');
});

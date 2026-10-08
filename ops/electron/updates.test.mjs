import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, compareVersions, parseVersion, releasesUrl } from './updates.mjs';
const release = (tag, extra = {}) => ({ tag_name: tag, body: '修复说明', assets: [{ name: 'study-log-desktop-0.1.0-x64-setup.exe' }], ...extra });
const response = values => async (url, options) => {
  assert.equal(url, releasesUrl); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, undefined);
  return { ok: true, json: async () => values };
};
test('version ordering handles numeric prereleases, stable versions and build metadata', () => {
  assert.equal(compareVersions('0.1.0-rc.10', 'v0.1.0-rc.9'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0-rc.99'), 1);
  assert.equal(compareVersions('1.0.0+one', '1.0.0+two'), 0);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  for (const value of ['0.1', '01.1.0', '1.0.0-rc.01', 'https://other.test', null]) assert.equal(parseVersion(value), null);
});
test('stable channel ignores prereleases, drafts and server-only releases', async () => {
  const result = await checkForUpdate('0.1.0', response([
    release('v0.3.0-rc.1', { prerelease: true }), release('v0.4.0', { draft: true }),
    release('v0.5.0', { assets: [] }), release('v0.2.0'), release('v0.3.0-rc.2')
  ]));
  assert.equal(result.version, '0.2.0');
});
test('prerelease channel selects highest applicable version and fixes the destination', async () => {
  const result = await checkForUpdate('0.1.0-rc.4', response([release('v0.1.0-rc.9'), release('v0.1.0-rc.10', { html_url: 'https://other.test' })]));
  assert.equal(result.url, 'https://github.com/Torry2022/study-log-workbench-public/releases/tag/v0.1.0-rc.10');
  assert.equal(result.version, '0.1.0-rc.10');
  assert.equal(await checkForUpdate('0.1.0-rc.10', response([release('v0.1.0-rc.9')])), null);
});
test('network, rate limit, missing Windows artifacts and malformed responses never mean up to date', async () => {
  await assert.rejects(checkForUpdate('0.1.0', async () => { throw Error('offline'); }));
  await assert.rejects(checkForUpdate('0.1.0', async () => ({ ok: false, status: 403 })));
  await assert.rejects(checkForUpdate('0.1.0', response({})));
  await assert.rejects(checkForUpdate('0.1.0', response([release('v1.0.0', { assets: [] })])));
});

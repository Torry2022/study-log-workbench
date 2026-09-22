import test from 'node:test';
import assert from 'node:assert/strict';
import { requestDownload, cancelWorkspaceRequests, workspaceRequestSignal, AUTH_EXPIRED_EVENT } from '../lib/client-http.ts';

function fixture(t) {
  const original = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = original; globalThis.window = oldWindow; cancelWorkspaceRequests(); });
}
const zip = (headers = {}) => new Response('synthetic ZIP bytes', { headers: { 'content-type': 'application/zip', ...headers } });

test('download keeps Chinese filename, ZIP bytes and missing-attachment count', async t => {
  fixture(t);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/study-log/api/export?scope=notes');
    assert.equal(init.cache, 'no-store');
    return zip({ 'content-disposition': `attachment; filename="notes.zip"; filename*=UTF-8''${encodeURIComponent('随记导出.zip')}`, 'x-export-warning-count': '2' });
  };
  const result = await requestDownload('/api/export?scope=notes');
  assert.equal(result.fileName, '随记导出.zip');
  assert.equal(result.warningCount, 2);
  assert.equal(await result.blob.text(), 'synthetic ZIP bytes');
});

test('malformed or unsafe download names and warning headers use safe defaults', async t => {
  fixture(t);
  for (const name of ['../escape.zip', 'C:\\escape.zip', 'hidden.html', '.hidden.zip']) {
    globalThis.fetch = async () => zip({ 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'x-export-warning-count': '-3' });
    const result = await requestDownload('/api/export');
    assert.equal(result.fileName, 'study-log-export.zip');
    assert.equal(result.warningCount, 0);
  }
  globalThis.fetch = async () => zip({ 'content-disposition': 'attachment; filename="fallback.zip"; filename*=UTF-8\'\'%invalid' });
  assert.equal((await requestDownload('/api/export')).fileName, 'fallback.zip');
});

test('download failure is retryable and successful HTML is not saved as ZIP', async t => {
  fixture(t);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '附件读取失败' }), { status: 500 });
  await assert.rejects(requestDownload('/api/export'), /附件读取失败/);
  globalThis.fetch = async () => new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(requestDownload('/api/export'), /不是 ZIP/);
  globalThis.fetch = async () => zip();
  assert.equal((await requestDownload('/api/export')).fileName, 'study-log-export.zip');
});

test('download 401 expires authentication once and a new session can retry', async t => {
  fixture(t);
  globalThis.window = new EventTarget();
  let expired = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => { expired++; cancelWorkspaceRequests(); });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  await assert.rejects(requestDownload('/api/export'), error => error.status === 401);
  assert.equal(expired, 1);
  globalThis.fetch = async () => zip();
  await requestDownload('/api/export');
});

test('captured authentication epoch cancels a download still waiting for confirmation', async t => {
  fixture(t);
  const signal = workspaceRequestSignal();
  cancelWorkspaceRequests();
  globalThis.fetch = () => { throw Error('must not send old confirmed request'); };
  await assert.rejects(requestDownload('/api/export', { signal }), error => error.name === 'AbortError');
});

test('late response and late blob cannot cross cancellation even if transport ignores abort', async t => {
  fixture(t);
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const responsePending = requestDownload('/api/export');
  cancelWorkspaceRequests(); release(zip());
  await assert.rejects(responsePending, error => error.name === 'AbortError');
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/zip' }), blob: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const controller = new AbortController();
  const bodyPending = requestDownload('/api/export', { signal: controller.signal });
  await reading; controller.abort(); release(new Blob(['old session']));
  await assert.rejects(bodyPending, error => error.name === 'AbortError');
});

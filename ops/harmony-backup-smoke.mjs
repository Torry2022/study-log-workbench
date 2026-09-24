import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

const [root, base] = process.argv.slice(2);
if (!root || !path.isAbsolute(root)) throw new Error('Provide an explicit synthetic instance root');
const url = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/study-log') {
  throw new Error('Only a local synthetic /study-log server is allowed');
}
const env = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8'));
const login = await fetch(`${base}/api/auth/app-login`, { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.APP_PASSWORD }) });
assert.equal(login.status, 200);
const { token } = await login.json();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const date = '2026-09-21';
const get = () => fetch(`${base}/api/logs/day?date=${date}`, { headers });
const write = (content, baseVersion) => fetch(`${base}/api/logs/day`, { method: 'PUT', headers,
  body: JSON.stringify({ date, content, baseVersion }) });
const before = await get(); assert.equal(before.status, 200);
assert.equal((await before.json()).day.exists, false, 'synthetic date must start empty');
const createdResponse = await write('### 1. 合成版本一\n\n甲', null);
assert.equal(createdResponse.status, 200);
const created = (await createdResponse.json()).day;
const updatedResponse = await write('### 1. 合成版本二\n\n乙', created.version);
assert.equal(updatedResponse.status, 200);
const updated = (await updatedResponse.json()).day;
const list = await fetch(`${base}/api/backups?date=${date}`, { headers });
assert.equal(list.status, 200);
const { backup } = await list.json();
assert(backup.write.length > 0);
const selected = backup.write[0];
const previewRequest = () => fetch(`${base}/api/backups/preview?date=${date}&kind=write&id=${encodeURIComponent(selected.id)}`, { headers });
const previewResponse = await previewRequest(); assert.equal(previewResponse.status, 200);
const { preview } = await previewResponse.json();
assert.match(preview.historicalContent, /合成版本一/);
assert.equal(preview.currentVersion, updated.version);
assert.match(preview.backupVersion, /^[a-f0-9]{64}$/);
const laterResponse = await write('### 1. 合成版本三\n\n丙', updated.version);
assert.equal(laterResponse.status, 200);
const stale = await fetch(`${base}/api/backups/restore`, { method: 'POST', headers,
  body: JSON.stringify({ date, kind: 'write', id: selected.id,
    baseVersion: preview.currentVersion, backupVersion: preview.backupVersion }) });
assert.equal(stale.status, 409, 'restore must reject a changed current source');
const refreshedResponse = await previewRequest(); assert.equal(refreshedResponse.status, 200);
const refreshed = (await refreshedResponse.json()).preview;
const restoredResponse = await fetch(`${base}/api/backups/restore`, { method: 'POST', headers,
  body: JSON.stringify({ date, kind: 'write', id: selected.id,
    baseVersion: refreshed.currentVersion, backupVersion: refreshed.backupVersion }) });
assert.equal(restoredResponse.status, 200);
const restored = (await restoredResponse.json()).day;
assert.match(restored.content, /合成版本一/);
const deleteResponse = await fetch(`${base}/api/logs/day`, { method: 'DELETE', headers,
  body: JSON.stringify({ date, baseVersion: restored.version }) });
assert.equal(deleteResponse.status, 200);
assert.equal((await deleteResponse.json()).day.exists, false);
process.stdout.write('Harmony App Token backup list, preview, stale conflict, restore and delete passed\n');

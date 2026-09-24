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
const date = '2026-09-20';
const get = () => fetch(`${base}/api/logs/day?date=${date}`, { headers });
const before = await get(); assert.equal(before.status, 200);
const { day: missing } = await before.json(); assert.equal(missing.exists, false);
const create = await fetch(`${base}/api/logs/day`, { method: 'PUT', headers,
  body: JSON.stringify({ date, content: '### 1. 合成编辑\n\n写入测试', baseVersion: null }) });
assert.equal(create.status, 200);
const { day: created } = await create.json();
assert.equal(created.exists, true); assert.ok(created.version);
assert.match(created.content, /合成编辑/);
const conflict = await fetch(`${base}/api/logs/day`, { method: 'PUT', headers,
  body: JSON.stringify({ date, content: '不得覆盖', baseVersion: null }) });
assert.equal(conflict.status, 409);
assert.equal((await conflict.json()).code, 'LOG_CONFLICT');
const read = await get(); assert.equal(read.status, 200);
assert.equal((await read.json()).day.content, created.content);
const remove = await fetch(`${base}/api/logs/day`, { method: 'DELETE', headers,
  body: JSON.stringify({ date, baseVersion: created.version }) });
assert.equal(remove.status, 200);
assert.equal((await remove.json()).day.exists, false);
process.stdout.write('Harmony App Token log save, conflict, read and delete passed\n');

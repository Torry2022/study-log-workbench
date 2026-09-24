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
const date = '2026-09-18';
const before = await fetch(`${base}/api/logs/day?date=${date}`, { headers });
assert.equal(before.status, 200);
assert.equal((await before.json()).day.exists, false);
const create = await fetch(`${base}/api/logs/day`, { method: 'PUT', headers,
  body: JSON.stringify({ date, content: '### 1. 合成链接目标\n\n仅供本机协议验证', baseVersion: null }) });
assert.equal(create.status, 200);
const created = (await create.json()).day;
try {
  const response = await fetch(`${base}/api/links?query=${encodeURIComponent('合成链接目标')}`, { headers });
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert(results.some(item => item.kind === 'heading' && item.date === date && item.heading === '合成链接目标'));
  assert(results.some(item => item.kind === 'day' && item.date === date));
  process.stdout.write('Harmony App Token internal-link date and heading search passed\n');
} finally {
  const remove = await fetch(`${base}/api/logs/day`, { method: 'DELETE', headers,
    body: JSON.stringify({ date, baseVersion: created.version }) });
  assert.equal(remove.status, 200);
}

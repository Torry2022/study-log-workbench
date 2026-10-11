import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const [modulePath, output] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath) && path.isAbsolute(output));
const root = path.join(output, 'synthetic-data');
await fs.mkdir(root, { recursive: true });
let bytes = 0;
for (let month = 1; month <= 6; month++) {
  const prefix = `2025-${String(month).padStart(2, '0')}`;
  const source = Array.from({ length: 28 }, (_, day) => `## ${prefix}-${String(day + 1).padStart(2, '0')}\n\n### 1. 合成记录\n\n${'缓存与日志导航的合成段落。\n\n'.repeat(80)}\n\`\`\`markdown\n---\n## 2000-01-01\n\`\`\`\n\n---\n\n`).join('');
  bytes += Buffer.byteLength(source);
  await fs.writeFile(path.join(root, `${prefix}_学习日志.md`), source);
}
const script = `import {performance} from 'node:perf_hooks'; const store = await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const times={}; for(const [name, call] of [['months',()=>store.listMonths()], ['days',()=>store.listDays('2025-06')], ['day',()=>store.getDay('2025-06-28')]]){ let start=performance.now();await call();const cold=performance.now()-start;const warm=[];for(let i=0;i<8;i++){start=performance.now();await call();warm.push(performance.now()-start);}times[name]={firstMs:cold,repeatMs:warm};} console.log(JSON.stringify(times));`;
const samples = [];
for (let i = 0; i < 5; i++) {
  const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { env: { ...process.env, LOG_ROOT: root }, windowsHide: true, timeout: 120000 });
  samples.push(JSON.parse(stdout));
}
const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length / 2)];
const summary = Object.fromEntries(['months','days','day'].map(name => [name, { firstMedianMs: median(samples.map(sample=>sample[name].firstMs)), repeatedMedianMs: median(samples.flatMap(sample=>sample[name].repeatMs)) }]));
const result = { sourceBytes: bytes, dates: 168, files: 6, samples, summary, note: 'Five fresh Node processes; month listing first, then date list and day. OS file cache is not cleared; timings are not end-to-end app startup.' };
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ sourceBytes: bytes, summary }));

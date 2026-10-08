import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DesktopManager } from './desktop/manager.mjs';

const execute = promisify(execFile);
const evidence = path.resolve('.local', `product-copy-${Date.now()}`);
await fs.mkdir(evidence);
const root = path.join(evidence, 'synthetic');
const manager = new DesktopManager({ packageRoot: path.join(evidence, 'program'),
  webRoot: path.resolve('study-log-web'), mcpRoot: path.resolve('study-log-mcp') });
const checks = ['browser-availability.mjs', 'browser-note-candidates.mjs', 'browser-backups.mjs', 'browser-internal-links.mjs'];
const passed = [];
try {
  await manager.select({ root, create: true, password: 'SyntheticCopyReviewOnly2026' });
  await fs.writeFile(path.join(root, 'data/2026-01_学习日志.md'), '## 2026-01-15\n\n### 阅读记录\n\n这是用于文案验收的合成材料。\n');
  await manager.start();
  for (const check of checks) {
    const result = await execute(process.execPath, [path.join('ops', check), root, manager.status().url],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    await fs.writeFile(path.join(evidence, `${check}.log`), result.stdout + result.stderr);
    passed.push(check);
  }
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed, paidCalls: 0,
    boundary: 'Synthetic instance; model responses intercepted by individual Playwright scripts; no daily app installation.' }, null, 2));
  console.log(evidence);
} finally { await manager.shutdown(); }

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DesktopManager } from './desktop/manager.mjs';
import { startBudgetProxy } from './model-budget-proxy.mjs';
import { learningCases } from './fixtures/default-learning-cases.mjs';

// Requires a reviewed budget reconciliation, new evidence directory and approved environment key.
const [evidence, manifestFile, mode = 'all'] = process.argv.slice(2);
assert.ok(['all', 'answers-only', 'extraction-only'].includes(mode));
assert.ok(evidence && path.isAbsolute(evidence) && manifestFile && path.isAbsolute(manifestFile));
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
let retained = 0;
for (const file of manifest.retainedLedgers) {
  const rows = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  retained += rows.at(-1).cumulativeReservedCny;
}
assert.ok(Math.abs(retained - manifest.expectedRetainedCny) < .000001);
assert.ok(manifest.reportedRecentCny >= 0 && manifest.totalBudgetCny - retained - manifest.reportedRecentCny >= manifest.runBudgetCny);
assert.ok(manifest.runBudgetCny > 0 && manifest.runBudgetCny <= 1);
assert.ok(process.env.DEEPSEEK_API_KEY, 'Approved environment credential is missing');
await fs.mkdir(evidence);
const manager = new DesktopManager({ packageRoot: path.join(evidence, 'program'), webRoot: path.resolve('study-log-web'), mcpRoot: path.resolve('study-log-mcp') });
let proxy;
const report = { rounds: [], budget: null, sourcePreserved: false, notesEmpty: false, stoppedNormally: false };
try {
  const root = path.join(evidence, 'instance'), password = crypto.randomBytes(24).toString('hex');
  await manager.select({ root, create: true, password });
  proxy = await startBudgetProxy({ apiKey: process.env.DEEPSEEK_API_KEY, apiUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', budgetCny: manifest.runBudgetCny, ledgerFile: path.join(evidence, 'ledger.jsonl') });
  await manager.configure({ apiUrl: proxy.url, apiKey: proxy.token, model: 'deepseek-flash' });
  const source = learningCases.map(sample => `## ${sample.date}\n\n${sample.content}\n\n---\n`).join('\n');
  const file = path.join(root, 'data/2026-10_学习日志.md'); await fs.writeFile(file, source);
  const base = (await manager.start()).url;
  const login = await fetch(base + '/api/auth/app-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200); const headers = { Authorization: `Bearer ${(await login.json()).token}`, 'Content-Type': 'application/json' };
  for (const sample of learningCases) {
    for (const task of mode === 'answers-only' ? ['answer'] : mode === 'extraction-only' ? ['extract'] : ['highlight', 'extract', 'answer']) {
      const round = { sample: sample.id, task, expected: sample.expected, status: null, result: null };
      report.rounds.push(round);
      const routes = { highlight: '/api/ai/bold-highlights', extract: '/api/notes/candidates', answer: '/api/rag/query' };
      const payload = task === 'highlight' ? { date: sample.date, content: sample.content } : task === 'extract' ? {
        documents: [{ fileName: sample.id + '.md', fileType: 'markdown', size: Buffer.byteLength(sample.content), text: sample.content,
          sections: [{ id: '1', locator: '正文', text: sample.content }], warnings: [] }] } : { question: sample.question, mode: 'logs_only' };
      try {
        const response = await fetch(base + routes[task], { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(240000) });
        round.status = response.status;
        if (task === 'answer' && response.ok) {
          const raw = await response.text();
          const frame = raw.split('\n\n').find(value => value.startsWith('event: done\n'));
          round.result = frame ? JSON.parse(frame.split('\ndata: ')[1]) : { error: 'No done event', stream: raw };
        } else round.result = await response.json();
      } catch (error) { round.error = error.name; }
      console.log(sample.id, task, round.status, round.error || 'completed');
      report.budget = proxy.report(); await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  report.sourcePreserved = (await fs.readFile(file, 'utf8')) === source;
  const notes = await fetch(base + '/api/notes', { headers }); report.notesEmpty = notes.ok && (await notes.json()).notes.length === 0;
  assert.ok(report.sourcePreserved && report.notesEmpty);
} finally {
  await manager.shutdown(); report.stoppedNormally = true;
  if (proxy) { report.budget = proxy.report(); await proxy.close(); }
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
}
console.log('Quality evidence saved; all outputs require content review.');

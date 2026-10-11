import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRagRetrieval } from '../lib/rag-retrieval-plan.ts';
import { EvidenceRun, collectRagEvidence } from '../lib/rag-evidence.ts';
import { validateRangePage } from '../lib/mcp-client.ts';
import { readLogRange } from '../../study-log-mcp/src/range-reader.mjs';

const cases = JSON.parse(await fs.readFile(new URL('./rag-routing-matrix.json', import.meta.url), 'utf8'));
const now = new Date('2026-10-11T04:00:00Z');
// Daily synthetic records expose accidental inclusion of gaps, not just correct endpoints.
const blocks = [];
for (let day = new Date('2025-01-01T00:00:00Z'); day <= new Date('2026-12-31T00:00:00Z'); day.setUTCDate(day.getUTCDate() + 1)) {
  const date = day.toISOString().slice(0, 10);
  blocks.push({ date, month: date.slice(0, 7), fileName: `${date.slice(0, 7)}_学习日志.md`, content: '合成资料' });
}
for (const c of cases) test(`routing matrix: ${c.id}`, async () => {
  const plan = planRagRetrieval(c.question, now);
  assert.equal(plan.strategy, c.strategy);
  assert.equal(plan.literalQuery, c.literal);
  assert.equal(Boolean(plan.invalidDate), c.id === 'invalid-date');
  const ranges = (plan.ranges || (plan.dateFrom ? [plan] : [])).map(p => [p.dateFrom, p.dateTo]);
  assert.deepEqual(ranges, c.ranges);
  if (!c.ranges.length || c.strategy === 'relevance') return;
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence(c.question, plan, run, { url: 'http://unused.test', token: 'synthetic' }, {
    search: async () => { throw Error('Range task must enumerate'); },
    read: async args => validateRangePage(readLogRange(blocks, args))
  });
  const expected = blocks.filter(b => c.ranges.some(([from, to]) => b.date >= from && b.date <= to)).map(b => b.date);
  assert.deepEqual([...new Set(run.contexts.map(item => item.date))].sort(), expected);
  assert.ok(run.coverage.every(scope => ['complete', 'empty'].includes(scope.status)));
});

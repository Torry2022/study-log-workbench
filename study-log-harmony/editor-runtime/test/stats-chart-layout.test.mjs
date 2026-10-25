import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const root = new URL('../../entry/src/main/ets/', import.meta.url);
async function actualMethods(file, names) {
  const source = await readFile(new URL(file, root), 'utf8');
  const methods = names.map(name => {
    const start = source.indexOf(`  private ${name}(`), end = source.indexOf('\n  }', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(start, end + 4);
  }).join('\n');
  const { code } = await transform(`class View { ${methods} }`, { loader: 'ts' });
  return new (new Function(`${code}; return View;`)())();
}

test('actual donut geometry keeps every domain and maps only the ring to its original domain', async () => {
  const chart = await actualMethods('features/stats/components/StatsDonut.ets', ['segments', 'arc', 'segmentAt']);
  chart.chartSize = 240;
  chart.domains = [{ domain: 'A', count: 3 }, { domain: 'B', count: 1 }];
  const segments = chart.segments();
  assert.deepEqual(segments.map(segment => [segment.domain.domain, segment.start, segment.end]), [['A', 0, 0.75], ['B', 0.75, 1]]);
  assert.equal(chart.segmentAt(200, 120), 0);
  assert.equal(chart.segmentAt(63.431, 63.431), 1);
  assert.equal(chart.segmentAt(120, 120), -1);
  assert.equal(chart.segmentAt(0, 0), -1);
  chart.domains = Array.from({ length: 12 }, (_, index) => ({ domain: `domain-${index}`, count: 1 }));
  assert.equal(chart.segments().length, 12, 'the native chart must not inherit DataPanel nine-segment truncation');
  assert.match(chart.arc(0, 1), /A 40 40[^]*A 40 40/);
  chart.domains = [];
  assert.deepEqual(chart.segments(), []);
  assert.equal(chart.segmentAt(200, 120), -1);
});

test('actual month layout groups cross-year selections without clipping a partial last row', async () => {
  const view = await actualMethods('common/ui/MonthNavigationGroups.ets', ['years', 'monthsForYear', 'gridHeight']);
  view.months = ['2025-02', '2026-10', '2026-08', '2026-09'].map(id => ({ id, label: id, count: 1 }));
  const before = structuredClone(view.months);
  assert.deepEqual(view.years(), ['2026', '2025']);
  assert.deepEqual(view.monthsForYear('2026').map(month => month.id), ['2026-10', '2026-09', '2026-08']);
  view.wide = false;
  assert.equal(view.gridHeight('2026'), 94);
  assert.equal(view.gridHeight('2025'), 44);
  view.wide = true;
  assert.equal(view.gridHeight('2026'), 126);
  assert.deepEqual(view.months, before);
});

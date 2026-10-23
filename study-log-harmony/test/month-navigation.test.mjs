import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

for (const [file, log] of [['logs/components/LogNavigation.ets', true], ['favorites/components/FavoritesNavigation.ets', false]]) {
  const source = await readFile(new URL(`../entry/src/main/ets/features/${file}`, import.meta.url), 'utf8');
  const methods = ['collapsedMonths', 'visibleMonths', 'hiddenMonthCount'].map(name => {
    const start = source.indexOf(`  private ${name}(`);
    assert.ok(start >= 0, `${file}: ${name}`);
    return source.slice(start, source.indexOf('\n  }', start) + 4);
  }).join('\n');
  const code = ts.transpileModule(`class Navigation { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Navigation = new Function(`${code}; return Navigation;`)();
  const ids = Array.from({ length: 8 }, (_, index) => `2026-${String(12 - index).padStart(2, '0')}`);
  const instance = new Navigation();
  const read = (months, selected, expanded = false) => {
    Object.assign(instance, { navigationMonths: months.map(id => ({ id })), navigationMonth: selected,
      navigationMonthsExpanded: expanded, data: { selectedMonth: selected }, months: () => months, monthsExpanded: expanded });
    return { shown: instance.visibleMonths().map(month => log ? month.id : month), hidden: instance.hiddenMonthCount() };
  };

  test(`${file}: newest six plus current older month survives selection changes and collapse`, () => {
    for (const count of [0, 6, 7, 8]) {
      const months = ids.slice(0, count);
      assert.deepEqual(read(months, months[0] || 'all'), { shown: months.slice(0, 6), hidden: Math.max(0, count - 6) });
      const selected = months.at(-1) || 'all';
      const expected = count > 6 ? [...months.slice(0, 6), selected] : months;
      const collapsed = read(months, selected);
      assert.deepEqual(collapsed, { shown: expected, hidden: count - expected.length });
      assert.deepEqual(read(months, selected, true).shown, months);
      assert.deepEqual(read(months, selected), collapsed);
      assert.deepEqual(read(months, 'missing').shown, months.slice(0, 6));
    }
    assert.deepEqual(read(ids, ids[6]).shown, [...ids.slice(0, 6), ids[6]]);
    assert.deepEqual(read(ids, ids[7]).shown, [...ids.slice(0, 6), ids[7]]);
    assert.equal(read(ids.slice(0, 7), ids[6]).hidden, 0);
    assert.ok(source.includes('if (this.hiddenMonthCount() > 0)'));
    assert.ok(source.includes('展开剩余 ${this.hiddenMonthCount()} 个月份'));
    if (log) assert.ok(source.includes('this.visibleMonths().length /'));
  });
}

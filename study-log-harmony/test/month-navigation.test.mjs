import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { currentShanghaiYear } from '../entry/src/main/ets/common/ui/MonthNavigation.ts';

for (const [file, log] of [['logs/components/LogNavigation.ets', true], ['favorites/components/FavoritesNavigation.ets', false]]) {
  const source = await readFile(new URL(`../entry/src/main/ets/features/${file}`, import.meta.url), 'utf8');
  const methods = ['collapsedMonths', 'visibleMonths', 'hiddenMonthCount'].map(name => {
    const start = source.indexOf(`  private ${name}(`);
    assert.ok(start >= 0, `${file}: ${name}`);
    return source.slice(start, source.indexOf('\n  }', start) + 4);
  }).join('\n');
  const code = ts.transpileModule(`class Navigation { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Navigation = new Function('currentShanghaiYear', `${code}; return Navigation;`)(() => '2026');
  const instance = new Navigation();
  const read = (months, selected, expanded = false) => {
    Object.assign(instance, { navigationMonths: months.map(id => ({ id })), navigationMonth: selected,
      navigationMonthsExpanded: expanded, data: { selectedMonth: selected }, months: () => months, monthsExpanded: expanded });
    return { shown: instance.visibleMonths().map(month => log ? month.id : month), hidden: instance.hiddenMonthCount() };
  };

  test(`${file}: current year and selected older month survive expand and collapse`, () => {
    const current = Array.from({ length: 12 }, (_, index) => `2026-${String(12 - index).padStart(2, '0')}`);
    const old = ['2025-12', '2025-08', '2024-01'];
    for (const months of [[], current.slice(0, 7), [...current, ...old], old, ['2027-01', ...current, ...old]]) {
      for (const selected of ['all', 'missing', current[0], ...old]) {
        const expected = months.filter(month => month.startsWith('2026-') || month === selected);
        assert.deepEqual(read(months, selected), { shown: expected, hidden: months.length - expected.length });
        assert.deepEqual(read(months, selected, true), { shown: months, hidden: months.length - expected.length });
        assert.deepEqual(read(months, selected).shown, expected);
      }
    }
    assert.deepEqual(read(current, 'all').shown, current);
    assert.deepEqual(read(old, 'all'), { shown: [], hidden: 3 });
    assert.ok(source.includes('if (this.hiddenMonthCount() > 0)'));
    assert.ok(source.includes('展开剩余 ${this.hiddenMonthCount()} 个月份'));
    if (log) {
      assert.ok(source.includes('this.visibleMonths().length /'));
      assert.equal(source.split('this.dateActions()').length - 1, 1);
      assert.ok(source.indexOf("Text('月份')") < source.indexOf("Text('日期')"));
      assert.ok(source.indexOf("Text('日期')") < source.indexOf('this.dateActions()'));
      assert.ok(source.indexOf('this.dateActions()') < source.indexOf('SearchField({'));
    }
  });
}

test('month year uses Shanghai midnight rather than the device local New Year', () => {
  assert.equal(currentShanghaiYear(new Date('2026-12-31T15:59:59.999Z')), '2026');
  assert.equal(currentShanghaiYear(new Date('2026-12-31T16:00:00.000Z')), '2027');
});

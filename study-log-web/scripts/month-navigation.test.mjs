import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const [file, log] of [['WorkspaceChrome.tsx', true], ['FavoritesNavigation.tsx', false]]) {
  const source = await readFile(new URL(`../components/${file}`, import.meta.url), 'utf8');
  const declarations = ['currentYear', 'collapsedMonths', 'shownMonths', 'hiddenMonthCount'].map(name => {
    const declaration = source.match(new RegExp(`  const ${name} = [^\\n]+;`));
    assert.ok(declaration, `${file}: ${name}`);
    return declaration[0];
  }).join('\n');
  const evaluate = new Function('months', 'selectedMonth', 'favorites', 'monthsExpanded', 'todayInShanghai',
    `${declarations}\nreturn { shownMonths, hiddenMonthCount };`);
  const read = (months, selected, expanded = false) => {
    const result = evaluate(log ? months.map(id => ({ id })) : months, selected, { filters: { month: selected } }, expanded, () => '2026-10-23');
    return { shown: result.shownMonths.map(month => log ? month.id : month), hidden: result.hiddenMonthCount };
  };

  test(`${file}: current year remains visible with cross-year selection and actual hidden count`, () => {
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
    assert.match(source, /\{hiddenMonthCount > 0 && <button className="sidebar-months-toggle"/);
    assert.match(source, /aria-expanded=\{monthsExpanded\}/);
    assert.ok(source.includes('展开剩余 ${hiddenMonthCount} 个月份'));
    assert.ok(source.includes('setMonthsExpanded(value => !value)'));
  });
}

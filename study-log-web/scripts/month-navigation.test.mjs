import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const [file, log] of [['WorkspaceChrome.tsx', true], ['FavoritesNavigation.tsx', false]]) {
  const source = await readFile(new URL(`../components/${file}`, import.meta.url), 'utf8');
  const declarations = ['collapsedMonths', 'shownMonths', 'hiddenMonthCount'].map(name => {
    const declaration = source.match(new RegExp(`  const ${name} = [^\\n]+;`));
    assert.ok(declaration, `${file}: ${name}`);
    return declaration[0];
  }).join('\n');
  const evaluate = new Function('months', 'selectedMonth', 'favorites', 'monthsExpanded',
    `${declarations}\nreturn { shownMonths, hiddenMonthCount };`);
  const ids = Array.from({ length: 8 }, (_, index) => `2026-${String(12 - index).padStart(2, '0')}`);
  const read = (months, selected, expanded = false) => {
    const result = evaluate(log ? months.map(id => ({ id })) : months, selected, { filters: { month: selected } }, expanded);
    return { shown: result.shownMonths.map(month => log ? month.id : month), hidden: result.hiddenMonthCount };
  };

  test(`${file}: newest six plus an older selection, actual hidden count, expand and collapse`, () => {
    for (const count of [0, 6, 7, 8]) {
      const months = ids.slice(0, count);
      const latest = read(months, months[0] || 'all');
      assert.deepEqual(latest.shown, months.slice(0, 6));
      assert.equal(latest.hidden, Math.max(0, count - 6));
      const selected = months.at(-1) || 'all';
      const expected = count > 6 ? [...months.slice(0, 6), selected] : months;
      const collapsed = read(months, selected);
      assert.deepEqual(collapsed.shown, expected);
      assert.equal(collapsed.hidden, months.length - expected.length);
      assert.deepEqual(read(months, selected, true).shown, months);
      assert.deepEqual(read(months, selected), collapsed);
      assert.deepEqual(read(months, 'missing').shown, months.slice(0, 6));
    }
    assert.deepEqual(read(ids, ids[6]).shown, [...ids.slice(0, 6), ids[6]]);
    assert.deepEqual(read(ids, ids[7]).shown, [...ids.slice(0, 6), ids[7]]);
    assert.equal(read(ids.slice(0, 7), ids[6]).hidden, 0);
    assert.match(source, /\{hiddenMonthCount > 0 && <button/);
    assert.ok(source.includes('展开剩余 ${hiddenMonthCount} 个月份'));
    assert.ok(source.includes('setMonthsExpanded(value => !value)'));
  });
}

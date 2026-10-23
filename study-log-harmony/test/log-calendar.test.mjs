import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/app/components/WorkspaceLogNavigation.ets', import.meta.url), 'utf8');
const names = ['calendarDate', 'calendarCells', 'canSelectCalendarDate', 'selectCalendarDate'];
const methods = names.map(name => {
  const start = source.indexOf(`  private ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
const code = ts.transpileModule(`class Calendar { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Calendar = new Function(`${code}; return Calendar;`)();

test('all month shapes keep six calendar rows, with correct Monday-first dates', () => {
  const calendar = new Calendar();
  for (let year = 2024; year <= 2028; year++) for (let month = 1; month <= 12; month++) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    calendar.logNavigation = { calendarMonth: prefix };
    const cells = calendar.calendarCells();
    assert.equal(cells.length, 42, prefix);
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const count = new Date(year, month, 0).getDate();
    assert.equal(cells[offset], `${prefix}-01`);
    assert.equal(cells[offset + count - 1], `${prefix}-${count}`);
    assert.equal(cells.filter(Boolean).length, count);
    assert.ok(cells.slice(offset + count).every(cell => cell === ''));
  }
});

test('create and jump preserve availability, failure guards and selection effects', () => {
  const calendar = new Calendar();
  const date = '2024-02-29';
  calendar.logNavigation = { calendarDates: [date], calendarLoading: false, calendarError: '' };
  calendar.calendarMode = 'jump';
  calendar.onOpenDate = selected => { calendar.opened = selected; };
  calendar.calendarOpen = true;
  calendar.selectCalendarDate(date);
  assert.equal(calendar.opened, date);
  assert.equal(calendar.calendarOpen, false);
  for (const state of [{ calendarLoading: true }, { calendarError: 'failed' }, { calendarDates: [] }]) {
    const before = { ...calendar.logNavigation };
    Object.assign(calendar.logNavigation, state);
    calendar.calendarOpen = true;
    calendar.opened = '';
    calendar.selectCalendarDate(date);
    assert.equal(calendar.calendarOpen, true);
    assert.equal(calendar.opened, '');
    calendar.logNavigation = before;
  }
  calendar.calendarMode = 'create';
  calendar.logNavigation.calendarError = 'failed';
  calendar.selectCalendarDate(date);
  assert.equal(calendar.newLogDate, date);
  assert.equal(calendar.calendarOpen, false);
  assert.equal(calendar.canSelectCalendarDate(''), false);
  assert.equal(calendar.canSelectCalendarDate('2999-01-01'), false);
});

test('compact create and jump share the safe modal; wide controls retain anchored popups', () => {
  assert.match(source, /AppModalFrame\(\{ content:.*this\.calendarDialogContent\(\)/);
  assert.match(source, /AppModalScrim\(\{ onDismiss:/);
  assert.match(source, /bindContentCover\(this\.calendarOpen && !this\.wide/);
  assert.match(source, /bindPopup\(this\.wide && this\.calendarOpen && this\.calendarMode === 'create'/);
  assert.match(source, /bindPopup\(this\.wide && this\.calendarOpen && this\.calendarMode === 'jump'/);
  assert.match(source, /onWillDismiss:.*this\.calendarOpen = false/);
  assert.match(source, /读取失败，点击重试[\s\S]*onClick\(\(\) => this\.loadCalendar\(\)\)/);
});


test('popup dismissal callbacks cannot clear a compact calendar, and feedback occupies one stable slot', () => {
  const callbacks = [...source.matchAll(/onStateChange: \(event\) => \{ ([^}]+) \}/g)];
  assert.equal(callbacks.length, 2);
  for (const [index, callback] of callbacks.entries()) {
    const invoke = new Function('event', callback[1]);
    const mode = index === 0 ? 'create' : 'jump';
    for (const wide of [false, true]) for (const visible of [false, true]) {
      const state = { wide, calendarOpen: true, calendarMode: mode };
      invoke.call(state, { isVisible: visible });
      assert.equal(state.calendarOpen, !(wide && !visible));
    }
  }
  const footer = source.slice(source.lastIndexOf('      Column() {', source.indexOf('if (this.logNavigation.calendarError)')), source.indexOf(".id('log_calendar_feedback')"));
  assert.ok(footer.includes('读取失败，点击重试'));
  assert.ok(footer.includes('正在读取日志日期…'));
  assert.ok(footer.includes("this.calendarMode === 'jump'"));
  assert.ok(footer.includes(".width('100%').height(56)"));
});

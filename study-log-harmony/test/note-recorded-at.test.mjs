import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const notes = await readFile(new URL('../entry/src/main/ets/features/notes/NotesPage.ets', import.meta.url), 'utf8');
const picker = await readFile(new URL('../entry/src/main/ets/features/notes/components/NoteRecordedAt.ets', import.meta.url), 'utf8');
const candidates = await readFile(new URL('../entry/src/main/ets/features/notes/components/NoteCandidateExtractor.ets', import.meta.url), 'utf8');
async function entrypoints() {
  const helperUrl = new URL('../entry/src/main/ets/features/notes/NoteTime.ets', import.meta.url);
  let helper = '';
  try { helper = (await readFile(helperUrl, 'utf8')).replace(/export /g, ''); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stamp = notes.slice(notes.indexOf('  private localTimestamp('), notes.indexOf('  private startNew('));
  const choose = picker.slice(picker.indexOf('  private choose('), picker.indexOf('  build()'));
  const candidateStamp = candidates.slice(candidates.indexOf('  private timestamp('), candidates.indexOf('  private async saveSelected('));
  const module = { exports: {} };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [Clock.now()])); }
    static now() { return Date.parse('2026-09-30T00:05:45Z'); } }
  const code = ts.transpileModule(`${helper}\nexport class Page { ${stamp} }\nexport class Picker { ${choose} }\nexport class Candidates { ${candidateStamp} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Date: Clock });
  return module.exports;
}

test('note creation and picker use Beijing wall time independently of device time zone', async () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Shanghai', 'UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      const { Page, Picker, Candidates } = await entrypoints();
      assert.equal(new Page().localTimestamp(), '2026-09-30T08:05:00+08:00', zone);
      assert.equal(new Candidates().timestamp(), '2026-09-30T08:05:00+08:00', 'candidate extraction: ' + zone);
      const panel = new Picker();
      let dateDialog, timeDialog, changed;
      panel.value = '2026-09-29T23:40:00+08:00';
      panel.onChange = value => { changed = value; };
      panel.getUIContext = () => ({ showDatePickerDialog: value => { dateDialog = value; },
        showTimePickerDialog: value => { timeDialog = value; } });
      panel.choose();
      assert.equal(dateDialog.selected.getDate(), 29, zone);
      assert.equal(dateDialog.selected.getHours(), 23, zone);
      assert.equal(dateDialog.end.getDate(), 30, zone);
      dateDialog.onDateAccept(new Date(2026, 8, 29));
      assert.equal(timeDialog.selected.getHours(), 23, zone);
      timeDialog.onAccept({ hour: 23, minute: 40 });
      assert.equal(changed, panel.value, 'unchanged choice must preserve its instant: ' + zone);
      dateDialog.onDateAccept(new Date(2026, 8, 30));
      timeDialog.onAccept({ hour: 9, minute: 0 });
      assert.equal(changed, '2026-09-30T08:05:00+08:00', 'future choice clamps in Beijing: ' + zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

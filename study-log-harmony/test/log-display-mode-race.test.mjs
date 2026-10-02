import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
function method(name) {
  const start = source.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing ${name}`);
  const end = source.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(end >= 0, `Missing ${name} boundary`);
  return source.slice(start, start + 1 + end);
}
const code = ts.transpileModule(`export class Reader {\n${method('switchMode')}\n${method('settleModeOnNextFrame')}\n}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
class FrameAction { constructor(callback) { this.callback = callback; } }
runInNewContext(code, { module, exports: module.exports, FrameAction });

test('reselecting source mode does not strand its covered transition', async () => {
  const frames = [];
  const reader = new module.exports.Reader();
  let covered = false;
  let finishes = 0;
  Object.assign(reader, {
    modeRequestRevision: 0,
    sourceMode: false,
    splitMode: true,
    editorReady: true,
    editor: {
      loadedDocumentKey: '2026-02-05',
      command: async () => ({ documentKey: '2026-02-05', text: 'synthetic draft' })
    },
    session: { day: { date: '2026-02-05' }, selectedDate: '2026-02-05' },
    documents: { dayRequestLoading: false },
    logNavigation: { daysLoading: false },
    workspaceTransition: {
      clear: () => { covered = false; },
      cover: async () => { covered = true; },
      finish: kind => { assert.equal(kind, 'mode'); covered = false; finishes++; }
    },
    getUIContext: () => ({ postFrameCallback: action => frames.push(action.callback) }),
    reportDraft: () => {},
    updateToolbarWidth: () => {},
    isWide: () => true,
    selectedTab: () => 0,
    headerWidth: 1000,
    modeLayoutRevision: 0
  });

  await reader.switchMode(true);
  assert.equal(covered, true);
  await reader.switchMode(true);
  for (const frame of frames) frame();

  assert.equal(reader.sourceMode, true);
  assert.equal(covered, false);
  assert.equal(finishes, 1);
});

test('reselecting the current mode cancels an uncommitted mode change', async () => {
  let releaseCover = () => {};
  let covered = false;
  const transition = {
    task: undefined,
    waitingKind: '',
    clear() {
      covered = false;
      this.waitingKind = '';
      releaseCover();
      this.task = undefined;
    },
    cover(kind) {
      this.waitingKind = kind;
      covered = true;
      this.task = new Promise(resolve => { releaseCover = resolve; });
      return this.task;
    },
    finish() { covered = false; }
  };
  const reader = new module.exports.Reader();
  Object.assign(reader, {
    modeRequestRevision: 0,
    sourceMode: false,
    splitMode: true,
    editorReady: true,
    editor: {
      loadedDocumentKey: '2026-02-05',
      command: async () => ({ documentKey: '2026-02-05', text: 'synthetic draft' })
    },
    session: { day: { date: '2026-02-05' }, selectedDate: '2026-02-05' },
    workspaceTransition: transition,
    reportDraft: () => {},
    isWide: () => true,
    selectedTab: () => 0
  });

  const pending = reader.switchMode(true);
  for (let i = 0; i < 3; i++) await Promise.resolve();
  assert.equal(covered, true);
  await reader.switchMode(false, true);
  await pending;

  assert.equal(reader.sourceMode, false);
  assert.equal(reader.splitMode, true);
  assert.equal(covered, false);
});

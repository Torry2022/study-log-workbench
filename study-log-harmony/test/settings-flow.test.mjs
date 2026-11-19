import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/app/components/SettingsPanel.ets', import.meta.url), 'utf8');
const names = ['aboutToAppear', 'aboutToDisappear', 'wide', 'currentSection', 'sections', 'sectionLabel', 'selectSection', 'requestBack', 'requestClose', 'syncSwitches', 'dialogHeight'];
const methods = names.map(name => {
  const start = source.search(new RegExp(`^  (?:private )?${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = source.slice(start + 1).search(/^  (?:private |aboutTo|@|build\()/m);
  assert.ok(end >= 0, `${name} boundary`);
  return source.slice(start, start + end + 1);
}).join('\n');
const code = ts.transpileModule(`export class Settings { ${methods} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
function fixture(width = 390, connected = true) {
  const frames = [], focus = [], reads = [], module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports,
    bundleManager: { getBundleInfoForSelfSync: () => ({ versionName: 'synthetic-version' }) },
    revealResults: (_context, setOpacity) => setOpacity(1),
    focusControl: { requestFocus: key => focus.push(key) }, FrameAction: class { constructor(action) { this.action = action; } } });
  const page = new module.exports.Settings();
  Object.assign(page, { panelWidth: width, connected, section: 'menu', initialSection: 'menu', focusRevision: 0, aiLoaded: false,
    editorWrap: true, rememberSearch: true, aiDetailsOpen: false, ai: { load: () => reads.push('load'), dispose: () => reads.push('dispose') },
    aiEditor: { editing: false, hasUnsavedChanges: () => false, dispose: () => reads.push('dispose-editor') }, keyboard: { clear: () => reads.push('clear-keyboard') },
    connectionKeyboard: { clear: () => reads.push('clear-connection-keyboard') },
    editKeyboard: { clear: () => reads.push('clear-ai-keyboard') },
    confirmation: { settle: accepted => { assert.equal(accepted, false); reads.push('cancel-confirmation'); } },
    scroller: { scrollTo: () => reads.push('scroll-top') }, onClose: () => reads.push('close'),
    onBackHandler: handler => page.back = handler,
    getUIContext: () => ({ postFrameCallback: frame => frames.push(frame.action) }) });
  return { page, frames, focus, reads };
}

test('actual settings use the content-width 840 boundary, four connected sections and only local sections while disconnected', () => {
  const { page } = fixture();
  assert.deepEqual(Array.from(page.sections()), ['records', 'ai', 'reading', 'about']);
  assert.deepEqual(Array.from(page.sections(), section => page.sectionLabel(section)), ['工作台连接', 'AI 服务', '外观与阅读', '关于']);
  for (const width of [320, 599, 600, 839]) { page.panelWidth = width; assert.equal(page.wide(), false); assert.equal(page.currentSection(), 'menu'); }
  for (const width of [840, 1040]) { page.panelWidth = width; assert.equal(page.wide(), true); assert.equal(page.currentSection(), 'records'); }
  page.connected = false;
  assert.deepEqual(Array.from(page.sections()), ['reading', 'about']);
  page.section = 'ai'; assert.equal(page.currentSection(), 'reading');
  page.selectSection('records'); assert.equal(page.currentSection(), 'reading');
});

test('section and width navigation preserve AI state and request ownership instead of reloading on every layout', () => {
  const { page, reads } = fixture();
  page.selectSection('ai'); assert.equal(page.currentSection(), 'ai'); assert.deepEqual(reads, ['scroll-top', 'load']);
  page.aiDetailsOpen = true; page.ai.summary = { model: 'synthetic' };
  page.panelWidth = 1040; assert.equal(page.currentSection(), 'ai');
  page.panelWidth = 390; page.requestBack(); assert.equal(page.currentSection(), 'menu');
  page.selectSection('reading'); page.selectSection('ai');
  assert.equal(reads.filter(value => value === 'load').length, 1);
  assert.equal(page.aiDetailsOpen, true); assert.equal(page.ai.summary.model, 'synthetic');
});

test('entering the AI section in a new settings lifecycle refreshes capabilities, including after closing a probe', () => {
  const { page } = fixture(); const refresh = [];
  page.ai.load = value => refresh.push(value); page.selectSection('ai'); assert.deepEqual(refresh, [true]);
  page.selectSection('reading'); page.selectSection('ai'); assert.deepEqual(refresh, [true]);
  const reopened = fixture().page; reopened.ai.load = value => refresh.push(value); reopened.initialSection = 'ai';
  reopened.aboutToAppear(); assert.deepEqual(refresh, [true, true]);
});

test('actual narrow Back returns to the settings list, wide Back closes, and unmounted frames cannot request focus', () => {
  const { page, frames, focus, reads } = fixture();
  page.aboutToAppear(); assert.equal(page.version, 'synthetic-version');
  page.selectSection('reading'); page.back(); assert.equal(page.currentSection(), 'menu');
  page.back(); assert.equal(reads.at(-1), 'close');
  page.panelWidth = 1040; page.selectSection('about'); page.back(); assert.equal(reads.at(-1), 'close');
  page.aboutToDisappear(); frames.shift()(); assert.deepEqual(focus, []); assert.ok(reads.includes('dispose'));
  for (const name of ['clear-keyboard', 'clear-connection-keyboard', 'clear-ai-keyboard']) assert.ok(reads.includes(name));
});

test('real layout keeps one scrollable form, theme and existing preference controls, no fixed desktop-height minimum', () => {
  assert.match(source, /\.width\(this\.wide\(\) \? 144 : 112\)\.height\(44\)/);
  assert.match(source, /\.arrowModifier\(this.selectArrow\(\)\)/);
  assert.match(source, /Scroll\(this\.scroller\)/); assert.doesNotMatch(source, /minHeight: (730|760|690)/);
  const choices = source.slice(source.indexOf('  private readingContent()'), source.indexOf('  private aboutContent()'));
  for (const control of ['reading_size', 'editor_size']) assert.match(choices, new RegExp(`, '${control}'\\)`));
  assert.equal((choices.match(/this\.preferenceChoice\(/g) || []).length, 2);
  assert.match(source, /\.id\('settings_' \+ key\)/);
  for (const control of ['settings_editor_wrap', 'settings_search_history', 'settings_reset', 'settings_change_connection']) assert.ok(source.includes(control));
  assert.match(source, /onAreaChange\(\(_old: Area, area: Area\) => this\.panelWidth = Number\(area\.width\)\)/);
  assert.doesNotMatch(source, /SegmentIndicator|setTimeout/);
});

test('desktop settings fit the current host and cap the maximum dialog height', () => {
  const { page } = fixture();
  for (const [height, expected] of [[1000, 640], [500, 450], [300, 270]]) {
    page.availableHeight = height;
    assert.equal(page.dialogHeight(), expected);
  }
});

test('all settings exits ask only for changed AI input and honor the decision', async () => {
  const { page, reads } = fixture(); page.aiEditor.editing = true;
  page.requestClose(); assert.deepEqual(reads, ['close']); reads.length = 0;
  page.aiEditor.hasUnsavedChanges = () => true;
  page.aiEditor.leaveMessage = () => 'changed';
  page.confirmation.ask = async () => false;
  page.requestClose(); await Promise.resolve(); assert.deepEqual(reads, []);
  page.confirmation.ask = async () => true;
  page.requestClose(); await Promise.resolve(); assert.deepEqual(reads, ['close']);
});

test('changing connection remains under Workspace Connection when the window narrows', () => {
  const { page, reads } = fixture(920);
  page.changingConnection = true;
  page.onCancelConnection = () => reads.push('cancel-connection');
  page.panelWidth = 390;
  page.selectSection('ai');
  assert.equal(page.currentSection(), 'records');
  page.requestBack();
  assert.deepEqual(reads, ['cancel-connection']);
});

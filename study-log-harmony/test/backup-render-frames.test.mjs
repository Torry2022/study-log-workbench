import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/features/logs/components/BackupPanel.ets', import.meta.url), 'utf8');
const methods = ['aboutToAppear', 'aboutToDisappear', 'renderPreview', 'selectVersion'].map(name => {
  const match = new RegExp(`^  (?:private )?(?:async )?${name}\\(`, 'm').exec(source);
  assert.ok(match);
  const end = source.slice(match.index + 1).search(/^  (?:private |aboutTo|@Builder|build\()/m);
  return source.slice(match.index, match.index + 1 + end);
}).join('\n');
function subject() {
  const module = { exports: {} }, frames = [], renders = [];
  runInNewContext(ts.transpileModule(`export class Panel { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports });
  const panel = new module.exports.Panel();
  Object.assign(panel, { lifecycle: 0, listRevision: 0, previewRevision: 1, frameBridge: {},
    webPageReady: true, webContentReady: false, previewLoading: false, previewError: '', conflict: false,
    selected: { id: 'one', createdAt: '2026-09-30' }, preview: { id: 'one', currentContent: 'current', historicalContent: 'history' },
    loadVersions() {}, onBusyChange() {}, darkTheme: () => true, time: () => '09-30', busy: () => false });
  panel.controller = { async runJavaScript(script) {
    runInNewContext(script, { window: { renderBackup: (...args) => renders.push(args),
      backupFrames: { rendered: revision => panel.frameBridge.onRendered(revision) } },
      requestAnimationFrame: callback => frames.push(callback) });
  } };
  panel.aboutToAppear();
  return { panel, frames, renders };
}
test('backup cold preview stays covered until the themed content crosses a paint frame', async () => {
  const { panel, frames, renders } = subject();
  await panel.renderPreview();
  assert.equal(renders[0][2], true);
  assert.equal(panel.webContentReady, false, 'JS completion is not paint completion');
  frames.shift()();
  assert.equal(panel.webContentReady, false);
  frames.shift()();
  assert.equal(panel.webContentReady, true);
});
test('obsolete backup paint callbacks cannot reveal a new selection or closed panel', async () => {
  for (const invalidate of [p => p.previewRevision++, p => p.aboutToDisappear(), p => p.webPageReady = false]) {
    const { panel, frames } = subject();
    await panel.renderPreview(); invalidate(panel);
    frames.shift()(); frames.shift()();
    assert.equal(panel.webContentReady, false);
  }
});
test('clicking the current successful backup does not request or redraw it', async () => {
  const { panel, frames, renders } = subject();
  panel.webContentReady = true;
  panel.repository = { preview() { assert.fail('duplicate preview request'); } };
  await panel.selectVersion(panel.selected);
  assert.equal(panel.previewRevision, 1);
  assert.equal(frames.length, 0);
  assert.equal(renders.length, 0);
});

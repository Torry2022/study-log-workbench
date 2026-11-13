import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('native editor bridge forwards finite progress only for its ready loaded document', async () => {
  const source = (await readFile(new URL('../entry/src/main/ets/common/editor/SourceEditor.ets', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('export class SourceEditorSession'), end = source.indexOf('@Component', start);
  assert.ok(start >= 0 && end > start);
  const module = { exports: {} };
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { module, exports: module.exports, webview: { WebviewController: class {} }, clearTimeout });
  const session = new module.exports.SourceEditorSession(), events = [];
  session.documentKey = 'day:2'; session.loadedDocumentKey = 'day:2'; session.ready = true;
  session.onScrollProgress = (key, progress) => events.push([key, progress]);
  const send = (key, progress) => session.message(JSON.stringify({ type: 'scroll', documentKey: key, progress }));
  send('day:1', 0.5); send('day:2', null); send('day:2', 0.5);
  session.loadedDocumentKey = 'day:1'; send('day:2', 0.6);
  session.loadedDocumentKey = 'day:2'; session.ready = false; send('day:2', 0.7);
  assert.deepEqual(events, [['day:2', 0.5]]);
});

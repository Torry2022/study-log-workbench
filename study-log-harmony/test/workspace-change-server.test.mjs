import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const start = source.indexOf('  private registerWorkspaceNavigation(');
const end = source.indexOf('\n  private ', start + 1);
assert.ok(start >= 0 && end > start);
const module = { exports: {} };
runInNewContext(ts.transpileModule(`export class Workspace { ${source.slice(start, end)} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { module, exports: module.exports, WorkspaceNavigationCommands: class {},
  AppStorage: { get: () => false } });

test('changing server opens a candidate without discarding drafts and ignores a stale mounted view', () => {
  const page = new module.exports.Workspace();
  page.sidebar = {};
  page.modules = { taxonomyOpen: true };
  let candidates = 0;
  page.modules.taxonomyDirty = true;
  page.createConnectionController = () => ({ id: ++candidates });
  const view = {};
  const commands = page.registerWorkspaceNavigation(view);
  commands.changeServer();
  assert.equal(candidates, 1);
  assert.equal(page.connectionOpen, true);
  assert.equal(page.modules.taxonomyDirty, true);
  page.workspaceNavigationView = undefined;
  commands.changeServer();
  assert.equal(candidates, 1);
  page.workspaceNavigationView = view;
  commands.changeServer();
  assert.equal(candidates, 1, 'repeated open cannot replace an in-flight candidate owner');
  page.connectionOpen = false;
  commands.changeServer();
  assert.equal(candidates, 2);
  assert.equal(page.modules.taxonomyDirty, true);
});

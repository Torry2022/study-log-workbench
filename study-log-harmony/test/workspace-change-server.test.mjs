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

test('changing server waits for an open taxonomy draft and ignores a stale continuation', () => {
  const page = new module.exports.Workspace();
  page.sidebar = {};
  page.modules = { taxonomyOpen: true };
  let pending, changes = 0;
  page.confirmQaLeave = next => next();
  page.confirmNotesLeave = next => next();
  page.confirmTaxonomyLeave = next => { pending = next; };
  page.changeServer = () => changes++;
  const view = { confirmLogLeave: next => next() };
  const commands = page.registerWorkspaceNavigation(view);
  commands.changeServer();
  assert.equal(changes, 0);
  assert.equal(typeof pending, 'function');
  page.workspaceNavigationView = undefined;
  pending();
  assert.equal(changes, 0);
  page.workspaceNavigationView = view;
  commands.changeServer();
  pending();
  assert.equal(changes, 1);
  page.modules.taxonomyOpen = false;
  commands.changeServer();
  assert.equal(changes, 2);
});

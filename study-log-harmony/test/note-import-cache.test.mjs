import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/common/files/NoteImportFile.ets', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022 } }).outputText;
function cache(failAt, size = 16) {
  const closed = [], removed = [], files = new Set();
  const module = { exports: {} };
  const io = { OpenMode: { READ_ONLY: 1, CREATE: 2, READ_WRITE: 4, TRUNC: 8 },
    openSync(path, mode) {
      if (mode === 1) return { fd: 1 };
      files.add(path); return { fd: 2 };
    },
    copyFileSync() { if (failAt === 'copy') throw Error('copy interrupted'); },
    closeSync(file) { closed.push(file.fd); },
    statSync() { if (failAt === 'stat') throw Error('stat failed'); return { size }; },
    unlinkSync(path) { removed.push(path); files.delete(path); }
  };
  runInNewContext(code, { module, exports: module.exports, require: () => ({ fileIo: io }) });
  return { run: () => module.exports.cacheImportUri({ cacheDir: '/synthetic-cache' }, 'file:///synthetic.txt', 0),
    closed, removed, files };
}

test('failed document copy or validation leaves no partial material cache and closes both handles', () => {
  for (const [failure, size] of [['copy', 16], ['stat', 16], ['', 0], ['', 21 * 1024 * 1024]]) {
    const h = cache(failure, size);
    assert.throws(h.run);
    assert.deepEqual(h.closed, [2, 1]);
    assert.equal(h.files.size, 0, failure || String(size));
    assert.equal(h.removed.length, 1);
    assert.match(h.removed[0], /^\/synthetic-cache\/note-import-/);
  }
});

test('successful document copy keeps one owned cache and returns original filename', () => {
  const h = cache('');
  const result = h.run();
  assert.equal(result.name, 'synthetic.txt');
  assert.equal(result.size, 16);
  assert.equal(h.files.has(result.path), true);
  assert.deepEqual(h.closed, [2, 1]);
  assert.deepEqual(h.removed, []);
});

test('candidate selection failure releases earlier caches without removing existing materials', async () => {
  const panelSource = await readFile(new URL('../entry/src/main/ets/features/notes/components/NoteCandidateExtractor.ets', import.meta.url), 'utf8');
  const method = panelSource.slice(panelSource.indexOf('  private async chooseFiles('), panelSource.indexOf('  private removeFile('));
  const compiled = ts.transpileModule(`export class Panel { ${method} }`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const fails of [true, false]) {
    const removed = [], module = { exports: {} };
    runInNewContext(compiled, { module, exports: module.exports, Error,
      activeInstance: { revision: 1 }, fileIo: { unlinkSync: path => removed.push(path) },
      picker: { DocumentSelectOptions: class {}, DocumentViewPicker: class {
        async select(options) { assert.equal(options.maxSelectNumber, 4); return ['one.txt', 'two.txt']; }
      } },
      cacheImportUri: (_context, uri) => {
        if (fails && uri === 'two.txt') throw Error('second file unreadable');
        return { path: '/synthetic-cache/' + uri, name: uri };
      }
    });
    const panel = new module.exports.Panel();
    Object.assign(panel, { files: [{ path: '/existing.txt', name: 'existing.txt' }], loading: false,
      saving: false, lifecycleRevision: 1, current: () => true, context: () => ({}), message: '', warning: '' });
    await panel.chooseFiles();
    assert.equal(panel.files.map(file => file.name).join(','), fails ? 'existing.txt' : 'existing.txt,one.txt,two.txt');
    assert.deepEqual(removed, fails ? ['/synthetic-cache/one.txt'] : []);
    assert.equal(panel.message, fails ? 'second file unreadable' : '');
  }
});

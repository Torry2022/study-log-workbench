import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await fs.readFile(new URL('../components/ExportMenu.tsx', import.meta.url), 'utf8');

function fixture() {
  const slots = [], effects = [], listeners = new Map(), calls = []; let cursor = 0, focused = '';
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useId() { cursor++; return 'export-menu'; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect(run, deps) { const index = cursor++, old = slots[index];
      if (old && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
      effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: run() }; }); }
  };
  class Node { constructor(inside) { this.inside = inside; } }
  const dom = { contains: node => node?.inside === true,
    querySelector: () => ({ focus() { focused = 'item'; } }) };
  const events = name => ({ addEventListener: (kind, callback) => listeners.set(`${name}:${kind}`, callback),
    removeEventListener: kind => listeners.delete(`${name}:${kind}`) });
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX } }).outputText, { module, exports: module.exports, Node,
    document: events('document'), window: events('window'), require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol('fragment') };
      if (name === 'lucide-react') return { Download: 'icon' };
      if (name.endsWith('.css')) return {};
      throw Error(name);
    } });
  const render = () => {
    cursor = 0; const tree = module.exports.ExportMenu({ scopes: [{ scope: 'day', label: '当前日志' }],
      onExport: scope => calls.push(scope), busy: false });
    tree.props.ref.current = dom;
    tree.props.children[0].props.ref.current = { focus() { focused = 'trigger'; } };
    for (const effect of effects.splice(0)) effect(); return tree;
  };
  const open = () => { render().props.children[0].props.onClick(); return render(); };
  return { render, open, calls, dom, Node, listeners, get focused() { return focused; },
    dispose() { for (const slot of slots) slot?.cleanup?.(); } };
}

test('WebKit null-relatedTarget focusout during an inside pointer click does not remove its menu before click', t => {
  const f = fixture(); t.after(() => f.dispose());
  const open = f.open(); open.props.onBlur({ currentTarget: f.dom, relatedTarget: null });
  const current = f.render(); assert.equal(current.props.children[0].props['aria-expanded'], true);
  current.props.children[1].props.children[0].props.onClick();
  assert.deepEqual(f.calls, ['day']); assert.equal(f.focused, 'trigger');
  assert.equal(f.render().props.children[0].props['aria-expanded'], false);
});

for (const route of ['keyboard', 'outside-pointer', 'window-blur']) test(`export menu still closes for ${route} without exporting`, t => {
  const f = fixture(); t.after(() => f.dispose()); const open = f.open();
  if (route === 'keyboard') open.props.onBlur({ currentTarget: f.dom, relatedTarget: new f.Node(false) });
  else if (route === 'outside-pointer') f.listeners.get('document:pointerdown')({ target: new f.Node(false) });
  else f.listeners.get('window:blur')();
  assert.equal(f.render().props.children[0].props['aria-expanded'], false); assert.deepEqual(f.calls, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import React from 'react';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const source = await fs.readFile(new URL('../components/SidebarMonthGroups.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
new Function('require', 'exports', code)(require, exported);
const render = (months, selectedMonth, onMonthChange = () => {}) => exported.SidebarMonthGroups({ months, selectedMonth, onMonthChange });
function walk(node) {
  return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
}
const months = ['2024-12', '2026-02', '2025-12', '2026-10', '2025-03'].map((id, index) => ({ id, label: id, count: index + 1 }));

test('actual shared month navigation lists months continuously in descending order without mutating input', () => {
  const before = structuredClone(months), nodes = walk(render(months, '2025-03'));
  assert.equal(nodes.filter(node => node.props.role === 'group' || node.props.className === 'sidebar-year-heading').length, 0);
  const buttons = nodes.filter(node => node.type === 'button');
  assert.deepEqual(buttons.map(node => node.props.children[0].props.children), ['2026-10', '2026-02', '2025-12', '2025-03', '2024-12']);
  assert.equal(buttons.filter(node => node.props['aria-current'] === 'true').length, 1);
  assert.deepEqual(months, before);
});

test('a cross-year month retains its full identity, count and selection callback', () => {
  const selected = [], nodes = walk(render(months, '2026-10', month => selected.push(month)));
  const button = nodes.find(node => node.type === 'button' && node.props.children[0].props.children === '2024-12');
  assert.equal(button.props.children[1].props.children, 1);
  button.props.onClick();
  assert.deepEqual(selected, ['2024-12']);
});

test('empty month navigation creates neither years nor selectable months', () => {
  assert.equal(walk(render([], '')).filter(node => node.type === 'button' || node.props.role === 'group').length, 0);
});

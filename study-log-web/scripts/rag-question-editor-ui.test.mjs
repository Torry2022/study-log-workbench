import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ragTimeSeparators } from '../lib/rag-message-time.ts';

const require = createRequire(import.meta.url), module = { exports: {} };
const source = await fs.readFile(new URL('../components/RagWorkspace.tsx', import.meta.url), 'utf8');
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  module, exports: module.exports, require: name => {
    if (!name.startsWith('@/')) return require(name);
    if (name.endsWith('.css')) return {};
    if (name.endsWith('/MarkdownPreview')) return { MarkdownPreview: () => null };
    if (name.endsWith('/WorkspaceState')) return { WorkspaceState: () => null };
    if (name.endsWith('/rag-answer')) return { stripRagCitationLabels: value => value };
    if (name.endsWith('/use-smooth-rag-answer')) return { useSmoothRagAnswer: message => ({ content: message?.content || '', pending: false }) };
    if (name.endsWith('/rag-reading-anchor')) return {};
    if (name.endsWith('/rag-message-time')) return { ragTimeSeparators };
    throw Error(name);
  }
});
const render = questionEdit => renderToStaticMarkup(React.createElement(module.exports.RagWorkspace, {
  active: true, visible: true, messages: [{ id: 'question', role: 'user', content: '原问题' }],
  questionEditing: true, editableQuestionIds: ['question'], questionEdit, initializing: false,
  question: '', stage: '', generating: false, themeMode: 'light', answerMode: 'logs_only',
  focusRequestToken: 0, sessionNavigationToken: 0, answerStartToken: 0
}));

test('normal inline editor has only cancel/send and hides user copy/edit until cancelled', () => {
  const html = render({ id: 'question', body: '修改稿', error: '', needsReview: false });
  assert.ok(html.includes('>取消</button>') && html.includes('>发送</button>'));
  assert.ok(!html.includes('重新读取并核对'));
  assert.ok(!html.includes('aria-label="复制问题"') && !html.includes('aria-label="编辑此问题"'));
  const restored = render(null);
  assert.ok(restored.includes('aria-label="复制问题"') && restored.includes('aria-label="编辑此问题"'));
});

test('inline editor never adds a separate recovery button, including error states', () => {
  for (const state of [{ error: '版本冲突', needsReview: false }, { error: '', needsReview: true }]) {
    assert.ok(!render({ id: 'question', body: '保留修改稿', ...state }).includes('重新读取并核对'));
  }
});

const workspaceSource = await fs.readFile(new URL('../components/Workspace.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Workspace.tsx', workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression;
function findFeedback(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'RagWorkspace') {
    expression = node.attributes.properties.find(item => item.name?.getText(ast) === 'feedback').initializer.expression.getText(ast);
  }
  ts.forEachChild(node, findFeedback);
}
findFeedback(ast); assert.ok(expression);
const feedbackModule = { exports: {} };
runInNewContext(ts.transpileModule(`export const Feedback = ({rag,active}) => (${expression});`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText, { module: feedbackModule, exports: feedbackModule.exports, require, CircleAlert: require('lucide-react').CircleAlert });

test('actual workspace error feedback offers one retry for edits and none for orphan drafts', () => {
  let retries = 0;
  const props = { active: true, rag: { error: '版本待确认', questionEdit: { id: 'question' }, reloadSession: () => retries++ } };
  const tree = feedbackModule.exports.Feedback(props);
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/>重试<\/button>/g) || []).length, 1);
  assert.ok(!html.includes('重新读取并核对') && !html.includes('>关闭</button>'));
  const elements = [];
  function walk(element) { if (!React.isValidElement(element)) return; elements.push(element); React.Children.forEach(element.props.children, walk); }
  walk(tree); elements.find(element => element.type === 'button').props.onClick(); assert.equal(retries, 1);
  assert.equal(renderToStaticMarkup(feedbackModule.exports.Feedback({ ...props, rag: { ...props.rag, questionEdit: { orphaned: true } } })), '');
  assert.ok(renderToStaticMarkup(feedbackModule.exports.Feedback({ ...props, rag: { ...props.rag, questionEdit: null } })).includes('>关闭</button>'));
});

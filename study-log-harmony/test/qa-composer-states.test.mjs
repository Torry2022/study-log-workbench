import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts = createRequire(new URL('../../study-log-web/package.json', import.meta.url))('typescript');
const source = (await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf(".id('qa_send')"), end = source.indexOf('.onClick(', start);
assert.ok(start >= 0 && end > start);
const button = source.slice(start, end);
const expression = (name, next) => {
  const match = button.match(new RegExp('\\.' + name + '\\(([\\s\\S]*?)\\)\\s*\\.' + next + '\\('));
  assert.ok(match, name); return match[1];
};
const helpers = ['composerText', 'stopButton', 'savingAnswer'].map(name =>
  source.match(new RegExp('  private ' + name + '\\([^\\n]+'))?.[0] || '').join('\n');
const module = { exports: {} };
const code = ts.transpileModule(`export class ButtonState {
  ${helpers}
  enabled() { return ${expression('enabled', 'accessibilityText')}; }
  opacity() { return ${expression('opacity', 'enabled')}; }
  label() { return ${expression('accessibilityText', 'bindTips')}; }
  color() { return ${expression('backgroundColor', 'fontColor')}; }
}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
runInNewContext(code, { module, exports: module.exports, $r: value => value });

function state(values = {}) {
  const host = new module.exports.ButtonState();
  Object.assign(host, { configured: true, queueEditId: '', queueEditContent: '',
    data: { question: '', sending: false, receivedDone: false, pendingWrite: undefined,
      sessionLoading: false, taskSaving: false, taskBlocked: false, taskSaveError: '',
      questionEdit: () => undefined, canQueueQuestion: () => false, queueBusy: false, queue: { items: [] }, ...values } });
  return host;
}

test('native send stop and save states use the same action palette and disabled feedback', () => {
  for (const [values, enabled, label, color, opacity] of [
    [{}, false, '发送问题', 'primary', 0.58],
    [{ question: '合成输入' }, true, '发送问题', 'primary', 1],
    [{ sending: true }, true, '停止生成', 'surface_dark', 1],
    [{ sending: true, receivedDone: true }, false, '正在保存回答', 'surface_dark', 0.58],
    [{ sending: true, pendingWrite: {} }, false, '正在保存回答', 'surface_dark', 0.58],
    [{ question: '合成输入', sessionLoading: true }, false, '发送问题', 'primary', undefined],
    [{ question: '合成输入', taskSaving: true }, false, undefined, undefined, undefined]
  ]) {
    const host = state(values);
    assert.equal(host.enabled(), enabled, JSON.stringify(values));
    if (label) assert.equal(host.label(), label);
    if (color) assert.equal(host.color(), 'app.color.' + color);
    if (opacity !== undefined) assert.equal(host.opacity(), opacity);
  }
  if (source.includes('private stopButton')) {
    const queue = state({ sending: true, question: '排队输入', canQueueQuestion: () => true });
    assert.equal(queue.enabled(), true); assert.equal(queue.label(), '发送问题');
    queue.queueEditId = 'queued'; queue.queueEditContent = '编辑队列'; queue.data.queue.items = [{ id: 'queued' }];
    assert.equal(queue.enabled(), true); assert.equal(queue.label(), '保存修改');
  }
});

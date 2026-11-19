import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../entry/src/main/ets/app/SettingsConfirmation.ets', import.meta.url), 'utf8');
const module = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
} }).outputText, { module, exports: module.exports, Observed: value => value });
const { SettingsConfirmation } = module.exports;

test('native settings confirmation resolves once and closing/cancel never accepts', async () => {
  const frames = [];
  const confirmation = new SettingsConfirmation(() => frames.push('open'), () => frames.push('close'));
  const cancel = confirmation.ask('合成标题', '合成说明', '执行', '保持');
  assert.equal(confirmation.title, '合成标题'); assert.equal(confirmation.cancelLabel, '保持');
  confirmation.settle(false); confirmation.settle(true);
  assert.equal(await cancel, false); assert.deepEqual(frames, ['open', 'close']);
  const accepted = confirmation.ask('第二项', '新的说明', '继续');
  assert.equal(confirmation.cancelLabel, '取消'); confirmation.settle(true); confirmation.settle(false);
  assert.equal(await accepted, true); assert.deepEqual(frames, ['open', 'close', 'open', 'close']);
});

test('replacing an outstanding confirmation cancels the previous operation', async () => {
  const confirmation = new SettingsConfirmation(() => {}, () => {});
  const first = confirmation.ask('第一项', '第一项说明', '执行');
  const second = confirmation.ask('第二项', '第二项说明', '执行');
  assert.equal(await first, false); confirmation.settle(true); assert.equal(await second, true);
});

test('settings use their app-styled native dialog without changing unrelated workspace alerts', async () => {
  const base = new URL('../entry/src/main/ets/', import.meta.url);
  const dialog = await readFile(new URL('app/components/SettingsConfirmDialog.ets', base), 'utf8');
  assert.match(dialog, /@CustomDialog/); assert.match(dialog, /maxWidth: 440, maxHeight: '84%'/);
  assert.match(dialog, /FlexWrap.Wrap/); assert.match(dialog, /Scroll\(\)/);
  assert.match(dialog, /app.color.canvas/); assert.match(dialog, /primary: true/);
  for (const name of ['SettingsPanel', 'AiSettingsForm']) {
    const form = await readFile(new URL(`app/components/${name}.ets`, base), 'utf8');
    assert.doesNotMatch(form, /AlertDialog/);
    assert.match(form, /autoCancel: true, cancel: \(\) => this\.(?:confirmation|leaveConfirmation).settle\(false\)/);
    assert.match(form, /aboutToDisappear[^\n]*\.settle\(false\)/);
  }
  const index = await readFile(new URL('pages/Index.ets', base), 'utf8');
  assert.match(index, /this.settingsConfirmation.ask\(replaced/);
  assert.match(index, /this.settingsConfirmation.ask\('断开当前工作台'/);
  assert.match(index, /aboutToDisappear[^\n]*this.settingsConfirmation.settle\(false\)/);
  assert.match(index, /AlertDialog.show\(\{ message: '随记尚未保存/);
});

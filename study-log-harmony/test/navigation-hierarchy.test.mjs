import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/common/ui/NavigationRowStyle.ets', import.meta.url), 'utf8');
const module = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, FontWeight: { Regular: 400, Medium: 500 }, TextAlign: { End: 'end' }, $r: key => key });
function effective(modifier) {
  const values = {};
  const attributes = new Proxy({}, { get: (_, name) => value => { values[name] = value; return attributes; } });
  modifier.applyNormalAttribute(attributes); return values;
}
test('shared section hierarchy cannot be smaller or weaker than primary rows and counts stay secondary', () => {
  const section = effective(new module.exports.NavigationSectionStyle());
  for (const selected of [false, true]) {
    const label = effective(new module.exports.NavigationLabelStyle(selected));
    const count = effective(new module.exports.NavigationCountStyle());
    assert.ok(section.fontSize >= label.fontSize);
    assert.ok(section.fontWeight > label.fontWeight);
    assert.equal(section.fontColor, 'app.color.body_strong');
    assert.ok(count.fontSize < label.fontSize);
    assert.equal(count.fontColor, 'app.color.muted_soft');
    assert.equal(count.textAlign, 'end'); assert.equal(count.flexShrink, 0);
  }
});

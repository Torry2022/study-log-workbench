import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const sourceStart = source.indexOf('            Column() {\n              if (this.pendingImageCount > 0)');
const previewStart = source.indexOf('            Row() {\n              Stack({ alignContent: Alignment.TopEnd })');
assert.ok(previewStart >= 0 && sourceStart > previewStart, 'native preview pane precedes source pane');
function argument(marker, start) {
  const at = source.indexOf(marker, start);
  assert.ok(at >= 0, marker);
  const begin = at + marker.length; let depth = 1;
  for (let end = begin; end < source.length; end++) {
    if (source[end] === '(') depth++;
    if (source[end] === ')' && --depth === 0) return source.slice(begin, end);
  }
  assert.fail('unclosed attribute: ' + marker);
}
function evaluate(expression, wide, sourceMode, splitMode) {
  return new Function('Visibility', 'return (' + expression + ')').call({
    isWide: () => wide, sourceMode, splitMode
  }, { Visible: 'visible', None: 'none' });
}
const sourceWidth = argument('.width(this.isWide()', sourceStart);
const previewWidth = argument('.width(this.isWide()', previewStart);
const sourceVisibility = argument('.visibility(', sourceStart);
const previewVisibility = argument('.visibility(', source.indexOf('.visibility(this.sourceMode', previewStart));
// The width marker includes the opening call to isWide/isLargeWorkspace.
const width = expression => 'this.isWide()' + expression;

test('native split order and widths preserve independent and narrow-window modes', () => {
  const cases = [
    [true, false, true, '50%', '50%', 'visible', 'visible'],
    [true, true, false, '100%', 0, 'visible', 'none'],
    [true, false, false, 0, '100%', 'none', 'visible'],
    [false, false, true, '100%', 0, 'visible', 'none'],
    [false, true, false, '100%', 0, 'visible', 'none'],
    [false, false, false, 0, '100%', 'none', 'visible']
  ];
  for (const [wide, sourceMode, splitMode, sw, pw, sv, pv] of cases) {
    assert.equal(evaluate(width(sourceWidth), wide, sourceMode, splitMode), sw);
    assert.equal(evaluate(width(previewWidth), wide, sourceMode, splitMode), pw);
    assert.equal(evaluate(sourceVisibility, wide, sourceMode, splitMode), sv);
    assert.equal(evaluate(previewVisibility, wide, sourceMode, splitMode), pv);
  }
});
test('only wide split owns the source left divider and retains the workspace bottom-right control', () => {
  const border = source.slice(sourceStart).match(/\.border\(\{\s*width: \{ left: ([^}]+)\}/);
  assert.ok(border);
  for (const [wide, split, expected] of [[true, true, 1], [true, false, 0], [false, true, 0]]) {
    assert.equal(evaluate(border[1], wide, false, split), expected);
  }
  assert.doesNotMatch(source.slice(sourceStart, sourceStart + 4400), /right: this\.isWide\(\) && this\.splitMode \? 1/);
  assert.doesNotMatch(source, /\.position\(\{ right: this\.splitMode \? '50%' : 0, bottom: 0 \}\)/);
  assert.match(source, /\.margin\(\{ right: 14, bottom: 14 \}\)\.zIndex\(3\)/);
  assert.match(source, /splitScrollEnabled: this\.splitMode && this\.isWide\(\)/);
});

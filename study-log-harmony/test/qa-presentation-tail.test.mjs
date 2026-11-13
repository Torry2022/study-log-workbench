import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../entry/src/main/resources/rawfile/markdown/qa-presentation.js', import.meta.url), 'utf8');
const scope = { Intl };
runInNewContext(source, scope);

for (const tail of ['\u200d', '\ud83d']) {
  test('the unchanged final snapshot reveals a held tail: ' + tail.charCodeAt(0).toString(16), () => {
    const answer = new scope.QaPresentation();
    const prefix = '已经显示的正文';
    const finalText = prefix + tail;
    answer.update('live', prefix, 'streaming', 0);
    answer.advance(300);
    answer.update('live', finalText, 'streaming', 320);
    answer.advance(620);
    assert.equal(answer.text, prefix);
    assert.equal(answer.pending, false, 'a held tail has no display work until the next snapshot');

    answer.update('live', finalText, 'complete', 630);
    answer.advance(930);
    assert.equal(answer.text, finalText);
    assert.equal(answer.pending, false);
  });
}

test('completion keeps draining the queued body together with the held tail', () => {
  const answer = new scope.QaPresentation();
  const finalText = '回答中的完整段落。'.repeat(40) + '尾\u200d';
  answer.update('live', finalText, 'streaming', 0);
  answer.advance(50);
  const displayed = answer.text;
  assert.ok(displayed && displayed.length < finalText.length);

  answer.update('live', finalText, 'complete', 60);
  assert.equal(answer.text, displayed);
  assert.equal(answer.pending, true);
  answer.advance(400);
  assert.equal(answer.text, finalText);
  assert.equal(answer.pending, false);
});

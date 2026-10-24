import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const properties = source.match(/ContentRefresh\(\{([\s\S]*?)refreshId: 'logs_content_refresh'/)?.[1];
assert.ok(properties, 'the actual log reader refresh entrypoint exists');
const options = new Function(`return ({ ${properties} });`);

test('log reader keeps native refresh mounted on wide and compact layouts while protecting unsafe states', () => {
  for (const wide of [false, true]) {
    for (let mask = 0; mask < 16; mask++) {
      const state = { isWide: () => wide, sourceMode: Boolean(mask & 1),
        session: { isDirty: () => Boolean(mask & 2) },
        documents: { dayRequestLoading: Boolean(mask & 4), saving: Boolean(mask & 8) } };
      const actual = options.call(state);
      assert.equal(actual.refreshSupported ?? true, true, `native Refresh must remain mounted: wide=${wide}`);
      assert.equal(actual.refreshEnabled, mask === 0, `source/dirty/loading/saving protections: mask=${mask}`);
    }
  }
});

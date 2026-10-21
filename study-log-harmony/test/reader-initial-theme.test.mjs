import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const reader = await readFile(new URL('../entry/src/main/ets/common/ui/MarkdownReader.ets', import.meta.url), 'utf8');
const html = await readFile(new URL('../entry/src/main/resources/rawfile/markdown/index.html', import.meta.url), 'utf8');

test('a cold reader configures ArkWeb color mode before its document starts', () => {
  const binding = reader.match(/\.darkMode\(([\s\S]*?)\)\s*\n\s*\./);
  assert.ok(binding, 'ArkWeb defaults to light even when the native application is dark');
  for (const themePreference of ['light', 'dark', 'system']) {
    for (const systemTheme of ['light', 'dark']) {
      const actual = runInNewContext(`(function() { return ${binding[1]}; }).call(preferences)`, {
        preferences: { themePreference, systemTheme }, WebDarkMode: { On: 'dark', Off: 'light' }
      });
      const expected = themePreference === 'system' ? systemTheme : themePreference;
      assert.equal(actual, expected);
      const document = { documentElement: { dataset: {} } };
      const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
      runInNewContext(bootstrap, { document, window: { matchMedia: () => ({ matches: actual === 'dark' }) } });
      assert.equal(document.documentElement.dataset.theme, expected, 'first HTML paint must use the same theme');
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..');
const read = async file => (await fs.readFile(path.resolve(web, file), 'utf8')).replace(/\r\n/g, '\n');
test('Logo foregrounds and compatibility icons derive from the same drawing', async () => {
  const light = await read('public/app-logo-light.svg');
  const dark = light.replaceAll('#D07A5F', '#d4876a').replaceAll('#171614', '#f5f0e8');
  assert.equal(await read('public/app-logo-dark.svg'), dark);
  for (const [theme, foreground, background, border] of [['base', light, '#FAF9F5', '#e6dfd8'], ['dark', dark, '#1C1A17', '#353028']]) {
    const media = `../study-log-harmony/entry/src/main/resources/${theme}/media`;
    assert.equal(await read(`${media}/app_icon_foreground.svg`), foreground);
    assert.match(await read(`${media}/app_icon_background.svg`), new RegExp(`fill="${background}"`));
    const colors = JSON.parse(await read(`../study-log-harmony/entry/src/main/resources/${theme}/element/color.json`));
    assert.equal(colors.color.find(item => item.name === 'logo_surface').value, background);
    const icon = await read(theme === 'base' ? 'app/icon.svg' : 'public/icon-dark.svg');
    assert.equal(icon, foreground.replace('<g ', `<rect x="16" y="16" width="992" height="992" rx="208" fill="${background}" stroke="${border}" stroke-width="32"/>\n  <g `));
    if (theme === 'dark') assert.equal(await read(`${media}/app_icon.svg`), icon);
  }
  const png = await fs.readFile(path.join(web, 'app/icon.png'));
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512);
  assert.deepEqual(await fs.readFile(path.resolve(web, '../study-log-harmony/entry/src/main/resources/base/media/app_icon.png')), png);
});

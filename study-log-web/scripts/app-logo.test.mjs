import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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


test('launch-only generation needs no browser dependency and leaves other platform assets untouched', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'study-logo-launch-'));
  const fixtureWeb = path.join(fixture, 'study-log-web');
  const resourceRoot = path.join(fixture, 'study-log-harmony/entry/src/main/resources');
  const script = path.join(fixtureWeb, 'scripts/generate-app-logo.mjs');
  const run = promisify(execFile);
  try {
    for (const directory of ['scripts', 'public', 'app']) await fs.mkdir(path.join(fixtureWeb, directory), { recursive: true });
    for (const theme of ['base', 'dark']) await fs.mkdir(path.join(resourceRoot, theme, 'media'), { recursive: true });
    await fs.copyFile(path.join(web, 'scripts/generate-app-logo.mjs'), script);
    const foreground = await read('public/app-logo-light.svg');
    const source = path.join(fixtureWeb, 'public/app-logo-light.svg');
    await fs.writeFile(source, foreground);
    const protectedFiles = [path.join(fixtureWeb, 'public/app-logo-dark.svg'), path.join(fixtureWeb, 'app/icon.svg'),
      path.join(resourceRoot, 'base/media/app_icon_foreground.svg')];
    for (const file of protectedFiles) await fs.writeFile(file, 'unchanged');
    const result = await run(process.execPath, [script, '--harmony-launch-only']);
    assert.match(result.stdout, /Generated only HarmonyOS launch layers/);
    for (const theme of ['base', 'dark']) for (const name of ['nodes', 'top', 'arrow', 'bottom']) {
      assert.match(await fs.readFile(path.join(resourceRoot, theme, `media/launch_${name}.svg`), 'utf8'), /viewBox="0 0 1024 1024"/);
    }
    for (const file of protectedFiles) assert.equal(await fs.readFile(file, 'utf8'), 'unchanged');
    assert.equal(await fs.readFile(source, 'utf8'), foreground);
    assert.equal(await fs.stat(path.join(fixtureWeb, 'app/icon.png')).catch(() => null), null);
    await fs.writeFile(source, foreground.replace(/<circle[^>]*\/>/, ''));
    await assert.rejects(run(process.execPath, [script, '--harmony-launch-only']), /Logo topology changed/);
    for (const file of protectedFiles) assert.equal(await fs.readFile(file, 'utf8'), 'unchanged');
  } finally {
    assert.ok(fixture.startsWith(path.join(os.tmpdir(), 'study-logo-launch-')));
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

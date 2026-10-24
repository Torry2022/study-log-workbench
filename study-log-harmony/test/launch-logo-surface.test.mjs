import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../entry/src/main/', import.meta.url);
test('animated launch logo uses the shared light and dark logo surface', async () => {
  const source = await readFile(new URL('ets/app/components/LaunchIntro.ets', root), 'utf8');
  const start = source.indexOf('  private introContent()');
  const end = source.indexOf("        Image($r('app.media.launch_nodes'))", start);
  assert.ok(start >= 0 && end > start);
  const frame = source.slice(start, end);
  assert.match(frame, /\.width\(84\)[\s\S]*\.height\(84\)[\s\S]*\.borderRadius\(17\)[\s\S]*\.backgroundColor\(\$r\('app.color.logo_surface'\)\)/);
  assert.ok(!frame.includes('app.color.surface_soft'));
  for (const [mode, expected] of [['base', '#FFFFFF'], ['dark', '#1C1A17']]) {
    const colors = JSON.parse(await readFile(new URL(`resources/${mode}/element/color.json`, root), 'utf8'));
    assert.equal(colors.color.find(item => item.name === 'logo_surface').value.toUpperCase(), expected);
  }
});

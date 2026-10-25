import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('four launch layers exactly partition the official foreground in both themes and retain gather directions', async () => {
  const main = new URL('../entry/src/main/', import.meta.url);
  const canonical = (await readFile(new URL('../../study-log-web/public/app-logo-light.svg', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const parts = svg => {
    const group = svg.match(/(<g\b[^>]*>)([\s\S]*?)(<\/g>)/);
    assert.ok(group);
    return { root: svg.match(/<svg\b[^>]*>/)[0], attributes: group[1], shapes: group[2].match(/<(?:path|circle)\b[^>]*\/>/g) };
  };
  const names = ['nodes', 'top', 'arrow', 'bottom'];
  for (const theme of ['base', 'dark']) {
    const officialSvg = (await readFile(new URL(`resources/${theme}/media/app_icon_foreground.svg`, main), 'utf8')).replace(/\r\n/g, '\n');
    assert.equal(officialSvg, theme === 'base' ? canonical : canonical.replaceAll('#D07A5F', '#d4876a').replaceAll('#171614', '#f5f0e8'));
    const official = parts(officialSvg);
    assert.match(official.root, /viewBox="0 0 1024 1024"/);
    const combined = [];
    for (const [index, name] of names.entries()) {
      const layer = parts(await readFile(new URL(`resources/${theme}/media/launch_${name}.svg`, main), 'utf8'));
      assert.equal(layer.root, official.root);
      assert.equal(layer.attributes, official.attributes);
      assert.equal(layer.shapes.length, index === 0 ? 4 : 1);
      combined.push(...layer.shapes);
    }
    assert.deepEqual(combined, official.shapes, `${theme}: no changed, duplicated or omitted geometry/paint`);
  }
  const source = (await readFile(new URL('ets/app/components/LaunchIntro.ets', main), 'utf8')).replace(/\r\n/g, '\n');
  for (const [name, axis, travel] of [['nodes', 'x', '-this.gatherX'],
    ['top', 'y', '-this.gatherY'], ['arrow', 'x', 'this.gatherX'], ['bottom', 'y', 'this.gatherY']]) {
    const image = source.slice(source.indexOf(`Image($r('app.media.launch_${name}'))`));
    assert.ok(image.startsWith(`Image($r('app.media.launch_${name}'))`));
    assert.ok(image.slice(0, image.indexOf('.translate') + 120).includes(`.translate({ ${axis}: ${travel} })`));
  }
  assert.doesNotMatch(source, /\.position\(|Circle\(/, 'the official foreground stays in SVG layers');
  assert.match(source, /this\.motion\.advance\(time\)/);
  for (const delay of [410, 470, 8000]) assert.ok(source.includes(`}, ${delay}));`));
});

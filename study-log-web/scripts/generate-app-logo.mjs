import fs from 'node:fs/promises';
import path from 'node:path';

// Only this transparent foreground is hand-edited; all platform copies are derived.
const web = path.resolve(import.meta.dirname, '..');
const harmony = path.resolve(web, '../study-log-harmony');
const light = (await fs.readFile(path.join(web, 'public/app-logo-light.svg'), 'utf8')).replace(/\r\n/g, '\n');
const dark = light.replaceAll('#D07A5F', '#d4876a').replaceAll('#171614', '#f5f0e8');
for (const [theme, foreground] of [['base', light], ['dark', dark]]) {
  const group = foreground.match(/<g\b[^>]*>([\s\S]*?)<\/g>/);
  const shapes = group?.[1].match(/<(?:path|circle)\b[^>]*\/>/g) || [];
  if (shapes.length !== 7 || group[1].replace(/<(?:path|circle)\b[^>]*\/>/g, '').trim()) {
    throw new Error('Logo topology changed; review the four launch animation layers before regenerating.');
  }
  const layers = [['nodes', shapes.slice(0, 4)], ['top', [shapes[4]]],
    ['arrow', [shapes[5]]], ['bottom', [shapes[6]]]];
  for (const [name, elements] of layers) {
    const svg = foreground.replace(group[1], `\n    ${elements.join('\n    ')}\n  `);
    await fs.writeFile(path.join(harmony, `entry/src/main/resources/${theme}/media/launch_${name}.svg`), svg);
  }
}
if (process.argv.includes('--harmony-launch-only')) {
  console.log('Generated only HarmonyOS launch layers from public/app-logo-light.svg.');
  process.exit(0);
}
const shell = (foreground, background, border) => foreground.replace('<g ', `<rect x="16" y="16" width="992" height="992" rx="208" fill="${background}" stroke="${border}" stroke-width="32"/>\n  <g `);
const lightIcon = shell(light, '#FAF9F5', '#e6dfd8');
const darkIcon = shell(dark, '#1C1A17', '#353028');
for (const [file, content] of [['public/app-logo-dark.svg', dark], ['app/icon.svg', lightIcon], ['public/icon-dark.svg', darkIcon]]) {
  await fs.writeFile(path.join(web, file), content);
}
for (const [theme, foreground, background] of [['base', light, '#FAF9F5'], ['dark', dark, '#1C1A17']]) {
  const media = path.join(harmony, `entry/src/main/resources/${theme}/media`);
  await fs.writeFile(path.join(media, 'app_icon_foreground.svg'), foreground);
  await fs.writeFile(path.join(media, 'app_icon_background.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${background}"/></svg>\n`);
}
await fs.writeFile(path.join(harmony, 'entry/src/main/resources/dark/media/app_icon.svg'), darkIcon);
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${lightIcon}`);
  const png = await page.screenshot({ omitBackground: true });
  for (const file of [path.join(web, 'app/icon.png'), path.join(harmony, 'entry/src/main/resources/base/media/app_icon.png')]) await fs.writeFile(file, png);
} finally { await browser.close(); }
console.log('Generated Web and HarmonyOS Logo resources from public/app-logo-light.svg.');

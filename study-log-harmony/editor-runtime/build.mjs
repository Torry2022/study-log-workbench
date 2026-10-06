import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// CSS, HTML and the backup renderer retain their existing separately reviewed resources.
await build({
  entryPoints: [fileURLToPath(new URL('src/editor.js', import.meta.url))],
  bundle: true, minify: true, format: 'iife', target: 'chrome100', legalComments: 'none',
  outfile: fileURLToPath(new URL('../entry/src/main/resources/rawfile/editor/editor.js', import.meta.url))
});

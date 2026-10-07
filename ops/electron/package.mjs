import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { packageWindows } from '../desktop/package-windows.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
await packageWindows(path.join(repository, '.local/electron-payload'), { archive: false });
const require = createRequire(new URL('../../study-log-web/package.json', import.meta.url));
const logo = await require('sharp')(path.join(repository, 'study-log-web/public/app-logo-light.svg')).resize(256, 256).png().toBuffer();
// Windows does not mask application icons: retain transparent rounded corners.
const background = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="48" fill="#F7F3ED"/></svg>');
const png = await require('sharp')(background).composite([{ input: logo }]).png().toBuffer();
await fs.writeFile(path.join(repository, '.local/electron-icon.png'), png);
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await fs.writeFile(path.join(repository, '.local/electron-icon.ico'), Buffer.concat([header, png]));
await promisify(execFile)(process.execPath, [path.join(here, 'node_modules/electron-builder/cli.js'), '--win', '--x64', '--publish', 'never'],
  { cwd: here, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).then(result => console.log(result.stdout));

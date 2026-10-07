import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoLinks } from '../instance.mjs';

// Maintainer-only stable trial shortcut. Does not modify a package or instance,
// stop services, or delete old builds; future updates only replace this shortcut.
const [entryDirectory, packageRoot] = process.argv.slice(2);
if (![entryDirectory, packageRoot].every(value => value && path.isAbsolute(value))) throw Error('Provide explicit entry and extracted package directories');
await assertNoLinks(entryDirectory); await assertNoLinks(packageRoot);
const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package-manifest.json'), 'utf8'));
if (manifest.format !== 'study-log-windows' || manifest.platform !== 'win32-x64') throw Error('Not a Windows workbench package');
const target = path.join(packageRoot, '启动学习日志.vbs');
await fs.access(target);
await fs.mkdir(entryDirectory, { recursive: true });
const entry = path.join(entryDirectory, '启动学习日志.vbs');
if (path.resolve(entry) === path.resolve(target)) throw Error('Shortcut must be outside the package');
const literal = target.replaceAll('"', '""');
const source = `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "wscript.exe " & Chr(34) & "${literal}" & Chr(34), 0, False\r\n`;
await assertNoLinks(entry);
await assertNoLinks(path.join(entryDirectory, '当前试用版本.json'));
await fs.writeFile(entry, Buffer.from('\ufeff' + source, 'utf16le'));
await fs.writeFile(path.join(entryDirectory, '当前试用版本.json'), JSON.stringify({ packageRoot, webBuild: manifest.webBuild }, null, 2));
console.log(JSON.stringify({ entry, packageRoot, webBuild: manifest.webBuild }));

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
// Acceptance runs explicitly isolate preferences and data from everyday use.
if (process.env.STUDY_LOG_DESKTOP_PROFILE) {
  if (!path.isAbsolute(process.env.STUDY_LOG_DESKTOP_PROFILE)) throw Error('Desktop profile must be absolute');
  app.setPath('userData', process.env.STUDY_LOG_DESKTOP_PROFILE);
}
const payload = app.isPackaged ? path.join(process.resourcesPath, 'payload') : repository;
const { DesktopManager, availablePort } = await import(pathToFileURL(path.join(payload, 'ops/desktop/manager.mjs')));
const { privateDirectory, atomicPrivateFile } = await import(pathToFileURL(path.join(payload, 'ops/desktop/security.mjs')));
const manager = new DesktopManager({ packageRoot: payload,
  ...(app.isPackaged ? { node: path.join(payload, 'runtime/node.exe') } : {
    webRoot: path.join(repository, 'study-log-web'), mcpRoot: path.join(repository, 'study-log-mcp'),
    node: path.join(repository, '.local/windows-runtime/node-v22.23.3-win-x64/node.exe')
  }) });
const preferences = path.join(app.getPath('userData'), 'desktop.json');
let win, quitting = false, finishing = false, nextRoot = null;

function trusted(event) {
  try {
    return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
      && manager.url && new URL(event.senderFrame.url).origin === new URL(manager.url).origin;
  } catch { return false; }
}
ipcMain.on('workbench:close', event => { if (trusted(event)) win.close(); });

async function authenticate(session) {
  const env = await manager.readEnvironment();
  const response = await fetch(manager.url + '/api/auth/login', { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.APP_PASSWORD }) });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !cookie?.startsWith('study_log_session=')) throw Error('无法连接本地工作台，请重新打开应用。');
  await session.cookies.set({ url: manager.url, name: 'study_log_session', value: cookie.slice(cookie.indexOf('=') + 1),
    path: '/', httpOnly: true, sameSite: 'lax' });
}

async function selectExisting() {
  if (finishing || manager.state !== 'running') return;
  const result = await dialog.showOpenDialog(win, { title: '打开已有资料', properties: ['openDirectory'] });
  if (result.canceled) return;
  const selected = result.filePaths[0];
  if (selected === manager.root) return;
  const inspected = await manager.inspect(selected);
  if (inspected.kind !== 'existing') throw Error(inspected.message || '请选择已有工作台资料所在的文件夹。');
  nextRoot = selected; win.close();
}

const reportError = error => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined,
  { type: 'error', title: '学习日志工作台', message: '操作未完成', detail: error.message, buttons: ['知道了'] });
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开已有资料…', click: () => void selectExisting().catch(reportError) },
      { label: '打开资料所在文件夹', click: () => { if (manager.root) void shell.openPath(manager.root); } },
      { type: 'separator' }, { label: '退出', accelerator: 'Alt+F4', click: () => win?.close() }
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '查看', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] }
  ]));
}

async function finishWindow() {
  if (finishing) return;
  finishing = true;
  await manager.operation(() => manager.shutdown());
  win = null;
  const selected = nextRoot; nextRoot = null;
  if (selected && manager.state === 'stopped') {
    finishing = false;
    try { await openWorkspace(selected); return; }
    catch (error) { await reportError(error); }
  }
  quitting = true; app.quit();
}

async function openWorkspace(root, createDefault = false) {
  await manager.operation(async () => {
    const inspected = await manager.inspect(root);
    if (inspected.kind === 'new' && !createDefault) throw Error('没有找到上次使用的资料，请检查文件夹是否被移动或删除。');
    await manager.select({ root, create: createDefault && inspected.kind === 'new', password: crypto.randomBytes(24).toString('base64url') });
    await manager.start();
    manager.ports.web = Number(new URL(manager.url).port);
    await atomicPrivateFile(preferences, JSON.stringify({ root: manager.root, webPort: manager.ports.web }, null, 2));
  });
  win = new BrowserWindow({ title: '学习日志工作台', width: 1440, height: 960, minWidth: 420, minHeight: 560, show: false,
    ...(app.isPackaged ? { icon: path.join(process.resourcesPath, 'icon.png') } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141413' : '#faf9f5',
    webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true,
      partition: `persist:workbench-${crypto.createHash('sha256').update(manager.root).digest('hex').slice(0, 24)}` } });
  const current = win;
  const clipboardAllowed = (contents, permission, origin) => contents === current.webContents
    && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission) && origin === new URL(manager.url).origin;
  current.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    let origin = ''; try { origin = new URL(details.requestingUrl).origin; } catch {}
    callback(clipboardAllowed(contents, permission, origin));
  });
  current.webContents.session.setPermissionCheckHandler((contents, permission, origin) => clipboardAllowed(contents, permission, origin));
  const outside = url => { try { return new URL(url).origin !== new URL(manager.url).origin; } catch { return true; } };
  current.webContents.on('will-navigate', (event, url) => { if (outside(url)) event.preventDefault(); });
  current.webContents.on('will-redirect', (event, url) => { if (outside(url)) event.preventDefault(); });
  current.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && outside(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  current.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(current, { type: 'question', title: '离开工作台',
      message: '当前内容尚未保存，是否离开？', buttons: ['继续编辑', '放弃修改并离开'], defaultId: 0, cancelId: 0 });
    if (choice === 1) event.preventDefault(); else nextRoot = null;
  });
  current.webContents.on('render-process-gone', () => { void reportError(new Error('页面意外退出，请关闭后重新打开。已保存的资料仍保留。')); });
  current.on('closed', () => { void finishWindow(); });
  current.once('ready-to-show', () => current.show());
  await authenticate(current.webContents.session);
  // Renew only the current local session, without reloading or losing editor state.
  const renewal = setInterval(() => { void authenticate(current.webContents.session).catch(reportError); }, 24 * 60 * 60 * 1000);
  current.once('closed', () => clearInterval(renewal));
  for (const service of manager.processes) service.ended.then(() => {
    if (manager.state === 'failed' && !finishing) void reportError(new Error(manager.issue));
  });
  menu(); await current.loadURL(manager.url);
}

app.on('before-quit', event => {
  if (!quitting) { event.preventDefault(); if (win) win.close(); else if (!finishing) void finishWindow(); }
});
app.on('window-all-closed', () => {});
if (!app.requestSingleInstanceLock()) { quitting = true; app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  void app.whenReady().then(async () => { try {
    await privateDirectory(app.getPath('userData'));
    let root = path.join(app.getPath('userData'), 'instance'), createDefault = false;
    try {
      const saved = JSON.parse(await fs.readFile(preferences, 'utf8')); root = saved.root;
      if (Number.isInteger(saved.webPort) && saved.webPort >= 1024 && saved.webPort <= 65535) {
        manager.ports.web = await availablePort(saved.webPort).catch(() => 0);
      }
    }
    catch (error) { if (error.code !== 'ENOENT') throw Error('无法读取上次使用的资料位置，请检查本地配置。'); createDefault = true; }
    await openWorkspace(root, createDefault);
  } catch (error) {
    await reportError(error); await manager.shutdown(); quitting = true; app.quit();
  } });
}

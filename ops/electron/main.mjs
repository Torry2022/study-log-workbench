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
let win, quitting = false, finishing = false, nextRoot = null, pendingAction = null, settingsWindow = null;

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

async function backup() {
  if (finishing || pendingAction || manager.state !== 'running') return;
  const result = await dialog.showSaveDialog(win, { title: '备份全部资料', defaultPath: `学习日志备份-${new Date().toISOString().slice(0, 10)}.slarchive`, filters: [{ name: '备份归档', extensions: ['slarchive'] }] });
  if (result.canceled) return;
  pendingAction = async () => { await manager.backup(result.filePath); };
  win.close();
}
async function restore() {
  if (finishing || pendingAction || manager.state !== 'running') return;
  const archive = await dialog.showOpenDialog(win, { title: '选择备份', properties: ['openFile'] });
  if (archive.canceled) return;
  await manager.verify(archive.filePaths[0]);
  const destination = await dialog.showOpenDialog(win, { title: '选择恢复位置（将在其中新建文件夹）', properties: ['openDirectory', 'createDirectory'] });
  if (destination.canceled) return;
  const root = path.join(destination.filePaths[0], `学习日志恢复-${Date.now()}`);
  const inspected = await manager.inspect(root);
  if (inspected.kind !== 'new') throw Error('请选择空文件夹，原有资料不会被覆盖。');
  pendingAction = async () => { await manager.restore(archive.filePaths[0], root); };
  win.close();
}
function settingsTrusted(event) {
  return settingsWindow && event.sender === settingsWindow.webContents
    && event.senderFrame === settingsWindow.webContents.mainFrame
    && event.senderFrame.url === pathToFileURL(path.join(here, 'settings.html')).href;
}
ipcMain.handle('settings:read', event => {
  if (!settingsTrusted(event)) throw Error('无效窗口');
  return manager.configuration();
});
ipcMain.handle('settings:save', (event, value) => {
  if (!settingsTrusted(event) || finishing || pendingAction) throw Error('当前无法保存');
  if (!value || typeof value.apiUrl !== 'string' || typeof value.model !== 'string'
    || typeof value.apiKey !== 'string' || typeof value.clearKey !== 'boolean') throw Error('模型配置格式无效');
  if (value.apiUrl) {
    const url = new URL(value.apiUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /[\s\\]/.test(value.apiUrl)) throw Error('模型接口地址无效');
  }
  if (/[\u0000-\u001f\u007f]/.test(value.model) || value.apiKey && /[^\x21-\x7e]/.test(value.apiKey)) throw Error('模型配置含无效字符');
  const config = { apiUrl: value.apiUrl, model: value.model, apiKey: value.apiKey, clearKey: value.clearKey };
  pendingAction = async () => { await manager.configure(config); };
  settingsWindow.close(); win.close();
});
async function settings() {
  if (finishing || pendingAction || manager.state !== 'running') return;
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ parent: win, modal: true, width: 600, height: 640, minWidth: 420, minHeight: 520,
    title: '模型设置', autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#151412' : '#faf9f5',
    webPreferences: { preload: path.join(here, 'settings-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.on('closed', () => { settingsWindow = null; });
  await settingsWindow.loadFile(path.join(here, 'settings.html'));
}

const reportError = error => dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined,
  { type: 'error', title: '学习日志工作台', message: '操作未完成', detail: error.message, buttons: ['知道了'] });
function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开已有资料…', click: () => void selectExisting().catch(reportError) },
      { label: '打开资料所在文件夹', click: () => { if (manager.root) void shell.openPath(manager.root); } },
      { label: '模型设置…', click: () => void settings().catch(reportError) },
      { label: '备份全部资料…', click: () => void backup().catch(reportError) },
      { label: '从备份恢复…', click: () => void restore().catch(reportError) },
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
  const selected = nextRoot, action = pendingAction, previous = manager.root;
  nextRoot = null; pendingAction = null;
  if ((selected || action) && manager.state === 'stopped') {
    try {
      if (action) await manager.operation(action);
    } catch (error) { await reportError(error); manager.root = previous; }
    try {
      await openWorkspace(selected || manager.root);
      finishing = false;
      return;
    } catch (error) { await reportError(error); await manager.shutdown(); }
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
    if (choice === 1) event.preventDefault(); else { nextRoot = null; pendingAction = null; }
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

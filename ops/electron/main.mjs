import { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, nativeTheme, shell, session, screen } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { normalizeOrigin, checkCapabilities, connectServer } from './server-connection.mjs';

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
let workspaceView, titleMenu, connectionWindow, nextConnection, connectionLocal;
let closeAfterTransition = false;
let savedPreferences = {}, active = { mode: 'local' };
const workspaceUrl = () => active.mode === 'remote' ? active.origin + '/study-log' : manager.url;
const remotePartition = target => 'persist:remote-' + crypto.createHash('sha256').update(target.origin + ':' + target.instanceId).digest('hex').slice(0, 24);
async function savePreferences() { await atomicPrivateFile(preferences, JSON.stringify(savedPreferences, null, 2)); }
let win, quitting = false, finishing = false, nextRoot = null, pendingAction = null, settingsWindow = null;

function trusted(event) {
  try {
    return win && event.sender === workspaceView?.webContents && event.senderFrame === workspaceView.webContents.mainFrame
      && workspaceUrl() && new URL(event.senderFrame.url).origin === new URL(workspaceUrl()).origin;
  } catch { return false; }
}
ipcMain.on('workbench:close', event => { if (trusted(event)) win.close(); });

function titlebarTrusted(event) {
  return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
    && event.senderFrame.url.split('?')[0] === pathToFileURL(path.join(here, 'titlebar.html')).href;
}
ipcMain.on('titlebar:menu', (event, id, x) => {
  if (!titlebarTrusted(event) || !Number.isInteger(id) || id < 0 || id > 3 || !Number.isFinite(x)) return;
  if (settingsWindow || connectionWindow || finishing) return;
  workspaceView.webContents.focus();
  titleMenu.items[id].submenu.popup({ window: win, x: Math.max(0, Math.min(win.getContentSize()[0] - 1, Math.round(x))), y: 36 });
});
ipcMain.on('titlebar:workspace', event => { if (titlebarTrusted(event)) workspaceView.webContents.focus(); });
ipcMain.on('workbench:theme', (event, theme) => {
  if (!trusted(event) || !['light', 'dark'].includes(theme)) return;
  win.setTitleBarOverlay({ color: theme === 'dark' ? '#151412' : '#faf9f5', symbolColor: theme === 'dark' ? '#f5f0e8' : '#141413' });
  win.webContents.send('titlebar:theme', theme);
});


function connectionTrusted(event) {
  return connectionWindow && event.sender === connectionWindow.webContents && event.senderFrame === connectionWindow.webContents.mainFrame
    && event.senderFrame.url === pathToFileURL(path.join(here, 'connection.html')).href;
}
ipcMain.handle('connection:pick-directory', async event => {
  if (!connectionTrusted(event) || finishing || pendingAction || nextConnection) return { error: '请等待当前操作完成。' };
  const current = connectionWindow;
  const selected = await dialog.showOpenDialog(current, { title: '选择资料文件夹', defaultPath: connectionLocal.root, properties: ['openDirectory', 'createDirectory'] });
  if (selected.canceled || current !== connectionWindow) return { canceled: true };
  try {
    const inspected = await manager.inspect(selected.filePaths[0]);
    if (inspected.kind === 'invalid') return { error: inspected.message };
    connectionLocal = { root: inspected.root, create: inspected.kind === 'new' };
    return { root: connectionLocal.root, kind: inspected.kind };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('connection:read', async event => {
  if (!connectionTrusted(event)) throw Error('无效窗口');
  const inspected = await manager.inspect(connectionLocal.root);
  if (inspected.kind === 'new' && !connectionLocal.create) { inspected.kind = 'invalid'; inspected.message = '没有找到原有资料，请重新选择文件夹。'; }
  const assets = app.isPackaged ? path.join(payload, 'web/public') : path.join(repository, 'study-log-web/public');
  return { kind: inspected.kind, error: inspected.message, logos: { light: pathToFileURL(path.join(assets, 'app-logo-light.svg')).href, dark: pathToFileURL(path.join(assets, 'app-logo-dark.svg')).href }, mode: win ? active.mode : savedPreferences.mode || 'local', origin: savedPreferences.remote?.origin || '', localHttp: savedPreferences.remote?.localHttp || false, root: connectionLocal.root };
});
ipcMain.handle('connection:select', async (event, value) => {
  if (!connectionTrusted(event) || finishing || pendingAction || nextConnection) return { error: '请等待当前操作完成。' };
  try {
    let target;
    if (value?.mode === 'local') {
      const inspected = await manager.inspect(connectionLocal.root);
      if (inspected.kind === 'invalid') throw Error(inspected.message);
      if (inspected.kind === 'new' && !connectionLocal.create) throw Error('没有找到原有资料，请重新选择文件夹。');
      target = { mode: 'local', ...connectionLocal };
    }
    else {
      if (value?.mode !== 'remote') throw Error('请选择使用方式');
      const result = await connectServer(value);
      target = { mode: 'remote', origin: result.origin, instanceId: result.instanceId, localHttp: value.localHttp === true };
      await session.fromPartition(remotePartition(target)).cookies.set({ url: result.origin, name: 'study_log_session', value: result.cookie,
        path: '/', expirationDate: result.expirationDate, httpOnly: true, secure: result.origin.startsWith('https:'), sameSite: 'lax' });
    }
    savedPreferences.usageConfirmed = true;
    connectionWindow.submitted = true; connectionWindow.close();
    if (win) { nextConnection = target; win.close(); }
    else { try { await openConnection(target); } catch (error) { await connection(error.message); } }
    return { ok: true };
  } catch (error) { return { error: error.message }; }
});
async function connection(message = '') {
  if (connectionWindow) { connectionWindow.focus(); return; }
  connectionLocal = { root: savedPreferences.root || path.join(app.getPath('userData'), 'instance'), create: !savedPreferences.root };
  connectionWindow = new BrowserWindow({ ...(win ? { parent: win, modal: true } : {}), title: '使用方式', useContentSize: true, width: 640, height: Math.min(520, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea.height - 80), minWidth: 420, minHeight: 320, show: false,
    autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#151412' : '#faf9f5',
    webPreferences: { preload: path.join(here, 'connection-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const current = connectionWindow;
  const updateBackground = () => current.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#151412' : '#faf9f5');
  nativeTheme.on('updated', updateBackground);
  current.once('closed', () => nativeTheme.removeListener('updated', updateBackground));
  current.once('ready-to-show', () => current.show());
  current.webContents.on('will-navigate', e => e.preventDefault()); current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.on('closed', () => { connectionWindow = null; if (!current.submitted && !win) { quitting = true; app.quit(); } });
  await current.loadFile(path.join(here, 'connection.html'));
  if (message) current.webContents.send('connection:notice', message);
}
async function openConnection(target) {
  if (target?.mode === 'remote') {
    const origin = normalizeOrigin(target.origin, target.localHttp);
    const remote = { ...target, origin };
    const response = await session.fromPartition(remotePartition(remote)).fetch(origin + '/study-log/api/capabilities', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const caps = response.ok ? await response.json() : null;
    if (!checkCapabilities(caps) || caps.instanceId !== remote.instanceId) throw Error('服务器连接已失效或实例已变化，请重新输入密码连接。');
    await openWorkspace(null, false, remote);
  } else {
    if (Number.isInteger(savedPreferences.webPort) && savedPreferences.webPort >= 1024 && savedPreferences.webPort <= 65535) manager.ports.web = await availablePort(savedPreferences.webPort).catch(() => 0);
    await openWorkspace(target.root || savedPreferences.root || path.join(app.getPath('userData'), 'instance'), target.root ? target.create === true : !savedPreferences.root);
  }
}
async function migration() {
  const result = await dialog.showMessageBox(win, { title: '迁移到服务器', message: '将本地资料转到服务器继续使用',
    detail: '先备份全部资料，在服务器恢复到新目录并核对内容，再通过“使用方式”连接服务器。迁移后以服务器为日常记录位置；本地资料保留，不会自动同步。备份包含实例配置，请妥善保管。', buttons: ['备份全部资料…', '取消'], cancelId: 1 });
  if (result.response === 0) await backup();
}

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
  titleMenu = Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开已有资料…', enabled: active.mode === 'local', click: () => void selectExisting().catch(reportError) },
      { label: '打开资料所在文件夹', enabled: active.mode === 'local', click: () => { if (manager.root) void shell.openPath(manager.root); } },
      { label: '模型设置…', enabled: active.mode === 'local', click: () => void settings().catch(reportError) },
      { label: '备份全部资料…', enabled: active.mode === 'local', click: () => void backup().catch(reportError) },
      { label: '从备份恢复…', enabled: active.mode === 'local', click: () => void restore().catch(reportError) },
      { type: 'separator' },
      { label: '使用方式…', click: () => void connection().catch(reportError) },
      { label: '迁移到服务器…', enabled: active.mode === 'local', click: () => void migration().catch(reportError) },
      { type: 'separator' }, { label: '退出', accelerator: 'Alt+F4', click: () => win?.close() }
    ] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] },
    { label: '帮助', submenu: [{ label: '关于学习日志工作台', click: () => void dialog.showMessageBox(win, { title: '关于学习日志工作台', message: '学习日志工作台', detail: `版本 ${app.getVersion()}`, buttons: ['关闭'] }) }] }
  ]);
  Menu.setApplicationMenu(titleMenu);
  win.setMenuBarVisibility(false);
}

async function finishWindow() {
  if (finishing) { closeAfterTransition = true; return; }
  finishing = true;
  await manager.operation(() => manager.shutdown());
  win = null;
  const target = nextConnection; nextConnection = null;
  const selected = nextRoot, action = pendingAction, previous = manager.root;
  if (target) {
    try { await openConnection(target); finishing = false; if (closeAfterTransition) { closeAfterTransition = false; await finishWindow(); } return; }
    catch (error) { await reportError(error); finishing = false; await connection(); return; }
  }
  nextRoot = null; pendingAction = null;
  if ((selected || action) && manager.state === 'stopped') {
    try {
      if (action) await manager.operation(action);
    } catch (error) { await reportError(error); manager.root = previous; }
    try {
      await openWorkspace(selected || manager.root);
      finishing = false;
      if (closeAfterTransition) { closeAfterTransition = false; await finishWindow(); }
      return;
    } catch (error) { await reportError(error); await manager.shutdown(); }
  }
  quitting = true; app.quit();
}

async function openWorkspace(root, createDefault = false, remote = null) {
  active = remote || { mode: 'local' };
  if (!remote) await manager.operation(async () => {
    const inspected = await manager.inspect(root);
    if (inspected.kind === 'new' && !createDefault) throw Error('没有找到上次使用的资料，请检查文件夹是否被移动或删除。');
    await manager.select({ root, create: createDefault && inspected.kind === 'new', password: crypto.randomBytes(24).toString('base64url') });
    await manager.start();
    manager.ports.web = Number(new URL(manager.url).port);
    savedPreferences = { ...savedPreferences, mode: 'local', root: manager.root, webPort: manager.ports.web };
    await savePreferences();
  });
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({ title: '学习日志工作台', width: 1440, height: 960, minWidth: 420, minHeight: 560, show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { height: 36, color: dark ? '#151412' : '#faf9f5', symbolColor: dark ? '#f5f0e8' : '#141413' },
    ...(app.isPackaged ? { icon: path.join(process.resourcesPath, 'icon.png') } : {}),
    backgroundColor: dark ? '#151412' : '#faf9f5',
    webPreferences: { preload: path.join(here, 'titlebar-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const current = win;
  current.webContents.on('will-navigate', event => event.preventDefault());
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  workspaceView = new WebContentsView({ webPreferences: {
    preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true,
    partition: remote ? remotePartition(remote) : `persist:workbench-${crypto.createHash('sha256').update(manager.root).digest('hex').slice(0, 24)}`
  } });
  const content = workspaceView.webContents;
  current.contentView.addChildView(workspaceView);
  const layout = () => { const [width, height] = current.getContentSize(); workspaceView.setBounds({ x: 0, y: 36, width, height: Math.max(0, height - 36) }); };
  current.on('resize', layout); layout();
  // The workspace owns beforeunload; the shell closes only after it accepts leaving.
  let contentClosed = false, closeRequested = false;
  current.on('close', event => {
    if (contentClosed) return;
    event.preventDefault();
    if (!closeRequested) { closeRequested = true; content.close({ waitForBeforeUnload: true }); }
  });
  content.once('destroyed', () => { contentClosed = true; if (!current.isDestroyed()) current.close(); });
  current.once('closed', () => { if (!content.isDestroyed()) content.close(); });
  let altOnly = false;
  content.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') altOnly = input.key === 'Alt';
    if (input.type === 'keyDown' && input.key === 'F10' || input.type === 'keyUp' && input.key === 'Alt' && altOnly) {
      event.preventDefault(); current.webContents.focus(); current.webContents.send('titlebar:focus'); altOnly = false;
    }
  });
  const clipboardAllowed = (contents, permission, origin) => contents === content
    && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission) && origin === new URL(workspaceUrl()).origin;
  content.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    let origin = ''; try { origin = new URL(details.requestingUrl).origin; } catch {}
    callback(clipboardAllowed(contents, permission, origin));
  });
  content.session.setPermissionCheckHandler((contents, permission, origin) => clipboardAllowed(contents, permission, origin));
  const outside = url => { try { return new URL(url).origin !== new URL(workspaceUrl()).origin; } catch { return true; } };
  content.on('will-navigate', (event, url) => { if (outside(url)) event.preventDefault(); });
  content.on('will-redirect', (event, url) => { if (outside(url)) event.preventDefault(); });
  content.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && outside(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  content.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(current, { type: 'question', title: '离开工作台',
      message: '当前内容尚未保存，是否离开？', buttons: ['继续编辑', '放弃修改并离开'], defaultId: 0, cancelId: 0 });
    if (choice === 1) event.preventDefault(); else { nextRoot = null; pendingAction = null; nextConnection = null; closeRequested = false; }
  });
  content.on('render-process-gone', () => { void reportError(new Error('页面意外退出，请关闭后重新打开。已保存的资料仍保留。')); });
  current.on('closed', () => { void finishWindow(); });

  if (!remote) await authenticate(content.session);
  // Renew only the current local session, without reloading or losing editor state.
  const renewal = remote ? null : setInterval(() => { void authenticate(content.session).catch(reportError); }, 24 * 60 * 60 * 1000);
  current.once('closed', () => clearInterval(renewal));
  for (const service of manager.processes) service.ended.then(() => {
    if (manager.state === 'failed' && !finishing) void reportError(new Error(manager.issue));
  });
  menu();
  await current.loadFile(path.join(here, 'titlebar.html'), { query: { icon: pathToFileURL(app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(repository, '.local/electron-icon.png')).href } });
  await content.loadURL(workspaceUrl());
  current.webContents.send('titlebar:location', remote ? remote.origin : '本地资料');
  if (remote) { savedPreferences = { ...savedPreferences, mode: 'remote', remote }; await savePreferences(); }
  current.show(); content.focus();
}

app.on('before-quit', event => {
  if (!quitting) { event.preventDefault(); if (win) win.close(); else if (!finishing) void finishWindow(); }
});
app.on('window-all-closed', () => {});
if (!app.requestSingleInstanceLock()) { quitting = true; app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else connectionWindow?.focus(); });
  void app.whenReady().then(async () => { try {
    await privateDirectory(app.getPath('userData'));
    try { savedPreferences = JSON.parse(await fs.readFile(preferences, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw Error('无法读取上次使用的资料位置，请检查本地配置。'); }
    if (savedPreferences.usageConfirmed !== true || (!savedPreferences.root && !savedPreferences.remote)) { await connection(); return; }
    if (savedPreferences.mode === 'remote') {
      try { await openConnection(savedPreferences.remote); }
      catch { await connection('请重新连接服务器。原有本地资料仍保留。'); }
    } else await openConnection({ mode: 'local' });
  } catch (error) {
    await reportError(error); await manager.shutdown(); quitting = true; app.quit();
  } });
}

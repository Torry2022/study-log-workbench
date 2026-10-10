import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test');
const er=createRequire(new URL('./package.json',import.meta.url));
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'settings-boundaries-'));
const evidence=path.resolve('.local',`settings-boundaries-${Date.now()}`);await fs.mkdir(evidence);
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env});
const applicationProcess=app.process();
const open=async(kind)=>{
 await app.evaluate(({Menu},label)=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label===label).click(),{model:'模型设置…',history:'日志历史版本…',connection:'使用方式…'}[kind]);
 const name={model:'settings.html',history:'history.html',connection:'connection.html'}[kind];
 try { await expect.poll(()=>app.windows().some(p=>p.url().endsWith(name))).toBe(true); } catch(error) { console.log(await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible()})),errors:globalThis.errors}))); throw error; }
 await expect.poll(()=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith(name))?.isVisible(),name)).toBe(true);
 return app.windows().find(p=>p.url().endsWith(name));
};
try{
 const page=await workspacePage(app); await app.evaluate(({dialog})=>{globalThis.errors=[];dialog.showMessageBox=async(...args)=>{globalThis.errors.push(args.at(-1).detail);return {response:0};};});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('titlebar.html'));w.setSize(1280,800);globalThis.ownerEvents=[];for(const event of ['hide','closed'])w.on(event,()=>globalThis.ownerEvents.push(event));});
 let loads=0;page.on('domcontentloaded',()=>loads++);
 const preferencesFile=path.join(profile,'desktop.json'),preferencesBefore=await fs.readFile(preferencesFile);
 const instanceRoot=JSON.parse(preferencesBefore).root;
 const configFile=path.join(instanceRoot,'.env');
 const before=await fs.readFile(configFile);
 const ownershipFile=path.join(instanceRoot,'data/.instance-operation.lock/owner.json'),ownershipBefore=await fs.readFile(ownershipFile);
 const originalWindows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.id));
 const observeClose=()=>app.evaluate(({BrowserWindow})=>{
  globalThis.settingsCloseEvents=[];
  const modal=BrowserWindow.getAllWindows().find(w=>w.isModal());
  for(const event of ['hide','close','closed'])modal.on(event,()=>globalThis.settingsCloseEvents.push(event));
 });
 const assertClosed=async(dialog,kind,method)=>{
  await expect.poll(()=>dialog.isClosed()).toBe(true);
  await expect.poll(()=>app.evaluate(()=>globalThis.settingsCloseEvents)).toEqual(kind==='connection'?['close','closed']:['hide','close','closed']);
  assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.id)),originalWindows,`${kind}/${method}: no leaked or recreated windows`);
  assert.equal(page.isClosed(),false);assert.deepEqual(await fs.readFile(configFile),before);
  assert.deepEqual(await fs.readFile(preferencesFile),preferencesBefore);
  assert.deepEqual(await fs.readFile(ownershipFile),ownershipBefore,`${kind}/${method}: services retain original ownership`);
 };
 const activateCancel=async(dialog,method)=>{
  const button=dialog.getByRole('button',{name:'取消',exact:true});
  try{if(method==='keyboard'){await button.focus();await button.press('Enter');}else await button.click();}
  catch(error){if(!dialog.isClosed()||!String(error.message).includes('Target page, context or browser has been closed'))throw error;}
 };
 for(const kind of ['model','history']){
  const dialog=await open(kind),save=dialog.getByRole('button',{name:'保存设置'});
  await expect(save).toBeDisabled();
  await dialog.evaluate(async kind=>{if(kind==='model')await window.modelSettings.save({apiUrl:'',model:'',apiKey:'',clearKey:false});else await window.historySettings.save(await window.historySettings.read());},kind);
  assert.equal(page.isClosed(),false);assert.equal(dialog.isClosed(),false);
  for(const theme of ['light','dark']){
   await dialog.emulateMedia({colorScheme:theme});
   await expect.poll(()=>dialog.evaluate(()=>document.documentElement.dataset.theme)).toBe(theme);
   const properties=['minHeight','paddingLeft','paddingRight','lineHeight','fontSize','fontWeight','borderRadius','backgroundColor','color','opacity'];
   const tokens=['--canvas','--surface-soft','--surface-card','--hairline','--ink','--body','--muted','--primary','--primary-active'];
   const webStyles=await page.evaluate(({theme,properties,tokens})=>{
    document.documentElement.dataset.theme=theme;
    const button=document.createElement('button');button.className='button primary';button.disabled=true;document.body.append(button);
    const style=getComputedStyle(button),root=getComputedStyle(document.documentElement);
    const result={button:Object.fromEntries(properties.map(key=>[key,style[key]])),tokens:Object.fromEntries(tokens.map(key=>[key,root.getPropertyValue(key).trim()]))};button.remove();return result;
   },{theme,properties,tokens});
   const dialogStyles=await dialog.evaluate(({properties,tokens})=>{
    const style=getComputedStyle(document.querySelector('[type=submit]')),root=getComputedStyle(document.documentElement);
    return {button:Object.fromEntries(properties.map(key=>[key,style[key]])),tokens:Object.fromEntries(tokens.map(key=>[key,root.getPropertyValue(key).trim()]))};
   },{properties,tokens});
   assert.deepEqual(dialogStyles,webStyles,`${kind}/${theme}: shared Web and dialog primitives`);
   const geometry=await dialog.evaluate(()=>({gap:innerHeight-document.querySelector('footer').getBoundingClientRect().bottom,overflow:document.documentElement.scrollHeight-innerHeight}));
   assert.ok(geometry.gap>=23&&geometry.gap<=25,JSON.stringify(geometry));assert.ok(geometry.overflow<=1);
   await dialog.screenshot({path:path.join(evidence,`${kind}-${theme}.png`)});
  }
  if(kind==='model'){
   await dialog.locator('[name=model]').fill('draft');await expect(save).toBeEnabled();
   await dialog.locator('[name=apiUrl]').fill('ftp://example.invalid');await save.click();await expect(dialog.locator('#notice')).toContainText('https://');
   await dialog.locator('[name=model]').fill('');await dialog.locator('[name=apiUrl]').fill('');await expect(save).toBeDisabled();
  }else{await dialog.locator('[name=enabled]').uncheck();await expect(save).toBeEnabled();await expect(dialog.locator('[name=days]')).toBeDisabled();}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isModal()).setContentSize(420,360));
  assert.ok(await save.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
  await dialog.screenshot({path:path.join(evidence,`${kind}-small.png`)});
  await observeClose();await activateCancel(dialog,'click');await assertClosed(dialog,kind,'click');
  for(const method of ['keyboard','native']){
   const reopened=await open(kind);await observeClose();
   if(method==='keyboard')await activateCancel(reopened,method);
   else await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isModal()).close());
   await assertClosed(reopened,kind,method);
  }
 }
 await page.getByRole('button',{name:'源码',exact:true}).filter({visible:true}).click();
 const editor=page.locator('.cm-content');await editor.click();await editor.press('Control+End');await page.keyboard.insertText('\n取消设置后保留的合成草稿');
 const draft=await editor.innerText();
 for(const kind of ['model','history','connection'])for(const method of ['click','keyboard','native']){
  const reopened=await open(kind);await observeClose();
  if(kind==='connection'){await reopened.locator('[value=remote]').check();await reopened.locator('[name=origin]').fill('https://example.invalid');}
  if(method==='native')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isModal()).close());
  else await activateCancel(reopened,method);
  await assertClosed(reopened,kind,method);assert.equal(await editor.innerText(),draft);
 }
 assert.equal(loads,0);assert.deepEqual(await app.evaluate(()=>globalThis.ownerEvents),[]);
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('settings:read');ipcMain.handle('settings:read',()=>{throw Error('synthetic read failure');});});
 const failed=await open('model');await expect(failed.locator('#notice')).toContainText('无法读取');await failed.locator('[name=model]').fill('cannot-save');await expect(failed.getByRole('button',{name:'保存设置'})).toBeDisabled();await failed.getByRole('button',{name:'取消'}).click();
 assert.deepEqual(await app.evaluate(()=>globalThis.errors),[]);
 for(const method of ['click','keyboard','native']){
  const initialProfile=await fs.mkdtemp(path.join(os.tmpdir(),'settings-first-cancel-'));
  const initialApp=await electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env:{...env,STUDY_LOG_DESKTOP_PROFILE:initialProfile}});
  const initialProcess=initialApp.process();
  try{
   await expect.poll(()=>initialApp.windows().some(p=>p.url().endsWith('connection.html'))).toBe(true);
   const chooser=initialApp.windows().find(p=>p.url().endsWith('connection.html'));await expect(chooser.getByRole('button',{name:'取消',exact:true})).toBeVisible();
   await expect.poll(()=>initialApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('connection.html'))?.isVisible())).toBe(true);
   const exited=initialApp.waitForEvent('close',{timeout:60000});
   if(method==='native')await initialApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('connection.html')).close());
   else await activateCancel(chooser,method);
   await exited;
   assert.equal(await fs.stat(path.join(initialProfile,'instance')).catch(()=>null),null);
   assert.equal(await fs.stat(path.join(initialProfile,'desktop.json')).catch(()=>null),null);
  }finally{if(initialProcess.exitCode===null)await initialApp.close();}
 }
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,checks:['unchanged model/history disabled','IPC no-op retains windows and configuration','changed and invalid fields','read failure cannot save','model/history/connection mouse cancel, keyboard cancel and native close share their native lifecycle','repeated cancellation retains original windows, draft, preferences and service ownership without navigation','first-use mouse/keyboard/native cancellation exits without creating records','Web/dialog light/dark theme and button parity','light/dark footer spacing','small window footer reachable'],profile}));console.log(evidence);
}finally{if(applicationProcess.exitCode===null){const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await closed;}}

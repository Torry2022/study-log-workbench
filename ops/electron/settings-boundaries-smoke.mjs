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
const open=async(kind)=>{
 await app.evaluate(({Menu},label)=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label===label).click(),kind==='model'?'模型设置…':'日志历史版本…');
 const name=kind==='model'?'settings.html':'history.html';
 try { await expect.poll(()=>app.windows().some(p=>p.url().endsWith(name))).toBe(true); } catch(error) { console.log(await app.evaluate(({BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible()})),errors:globalThis.errors}))); throw error; }
 await expect.poll(()=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith(name))?.isVisible(),name)).toBe(true);
 return app.windows().find(p=>p.url().endsWith(name));
};
try{
 const page=await workspacePage(app); await app.evaluate(({dialog})=>{globalThis.errors=[];dialog.showMessageBox=async(...args)=>{globalThis.errors.push(args.at(-1).detail);return {response:0};};});
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1280,800);globalThis.ownerEvents=[];for(const event of ['hide','closed'])w.on(event,()=>globalThis.ownerEvents.push(event));});
 let loads=0;page.on('domcontentloaded',()=>loads++);
 const configFile=path.join(JSON.parse(await fs.readFile(path.join(profile,'desktop.json'),'utf8')).root,'.env');
 const before=await fs.readFile(configFile);
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
  await dialog.getByRole('button',{name:'取消'}).click();await expect.poll(()=>dialog.isClosed()).toBe(true);
  assert.equal(page.isClosed(),false);assert.deepEqual(await fs.readFile(configFile),before);
 }
 assert.equal(loads,0);assert.deepEqual(await app.evaluate(()=>globalThis.ownerEvents),[]);
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('settings:read');ipcMain.handle('settings:read',()=>{throw Error('synthetic read failure');});});
 const failed=await open('model');await expect(failed.locator('#notice')).toContainText('无法读取');await failed.locator('[name=model]').fill('cannot-save');await expect(failed.getByRole('button',{name:'保存设置'})).toBeDisabled();await failed.getByRole('button',{name:'取消'}).click();
 assert.deepEqual(await app.evaluate(()=>globalThis.errors),[]);
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,checks:['unchanged model/history disabled','IPC no-op retains windows and configuration','changed and invalid fields','read failure cannot save','cancel retains owner and config without navigation','Web/dialog light/dark theme and button parity','light/dark footer spacing','small window footer reachable'],profile}));console.log(evidence);
}finally{if(app.process().exitCode===null){const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().reverse().forEach(w=>w.close()));await closed;}}

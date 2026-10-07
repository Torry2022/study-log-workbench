import { workspacePage } from './workspace-test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const exec=promisify(execFile);
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test');
if(process.platform!=='win32')throw Error('Windows only');
const [oldArg,newArg]=process.argv.slice(2);
if(!oldArg||!newArg)throw Error('Usage: node ops/electron/install-smoke.mjs OLD_INSTALLER NEW_INSTALLER');
const installers=[path.resolve(oldArg),path.resolve(newArg)];
for(const file of installers)assert.ok((await fs.stat(file)).isFile());
const allowedProfiles=['study-log-desktop','学习日志工作台'].map(name=>path.join(process.env.APPDATA,name));
for(const profile of allowedProfiles)await assert.rejects(fs.stat(profile),{code:'ENOENT'},'Existing app data must not be touched');
const registry=async()=>{
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '学习日志工作台*' } | Select-Object DisplayName,InstallLocation,UninstallString) | ConvertTo-Json -Compress`],{windowsHide:true});
 const result=stdout.trim()?JSON.parse(stdout):[];return (Array.isArray(result)?result:[result]).map(entry=>{
  const uninstaller=entry.UninstallString?.match(/^"([^"\r\n]+)"/u)?.[1];
  return {...entry,InstallLocation:entry.InstallLocation||(uninstaller?path.dirname(uninstaller):'')};
 });
};
assert.equal((await registry()).length,0,'Existing installation must not be touched');
const {stdout:running}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name = '学习日志工作台.exe'\").Count"],{windowsHide:true});
assert.equal(Number(running.trim()),0,'Close existing desktop applications before installation testing');

const evidence=path.resolve('.local',`electron-install-${Date.now()}`);await fs.mkdir(evidence);
const install=path.join(evidence,'program');
const exe=path.join(install,'学习日志工作台.exe');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.STUDY_LOG_DESKTOP_PROFILE;
let application,profile,root;
const passed=[], installedVersions=[];
const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const installPackage=async file=>{
 console.log('Installing candidate:',path.basename(path.dirname(file)));
 await exec(file,['/S',`/D=${install}`],{windowsHide:true,env,timeout:300000});
 await expect.poll(async()=>{try{return(await fs.stat(exe)).isFile();}catch{return false;}},{timeout:60000}).toBe(true);
 const entries=await registry();assert.equal(entries.length,1);assert.equal(path.resolve(entries[0].InstallLocation),install);
};
const launch=async()=>{
 application=await electron.launch({executablePath:exe,env,timeout:60000});
 const page=await workspacePage(application);page.on('dialog',()=>{});
 await expect(page.locator('.workspace')).toBeVisible({timeout:60000});
 installedVersions.push(await application.evaluate(({app})=>app.getVersion()));
 const actual=await application.evaluate(({app})=>app.getPath('userData'));
 assert.ok(allowedProfiles.includes(actual));if(profile)assert.equal(actual,profile);profile=actual;
 root=JSON.parse(await fs.readFile(path.join(profile,'desktop.json'),'utf8')).root;
 assert.equal(root,path.join(profile,'instance'));return page;
};
const close=async()=>{
 const ended=application.waitForEvent('close',{timeout:60000});
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await ended;application=null;
 await assert.rejects(fs.stat(path.join(root,'data/.instance-operation.lock')),{code:'ENOENT'});
};
const uninstall=async()=>{
 const entries=await registry();assert.equal(entries.length,1);assert.equal(path.resolve(entries[0].InstallLocation),install);
 const file=path.join(install,'Uninstall 学习日志工作台.exe');assert.ok((await fs.stat(file)).isFile());
 console.log('Uninstalling isolated candidate');
 await exec(file,['/S'],{windowsHide:true,env,timeout:300000});
 await expect.poll(async()=>(await registry()).length,{timeout:60000}).toBe(0);
 await expect.poll(async()=>{try{await fs.stat(exe);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}},{timeout:60000}).toBe(false);
};
try{
 await installPackage(installers[0]);let page=await launch();
 await page.getByRole('button',{name:'今天',exact:true}).click();
 const editor=page.locator('.cm-content');await expect(editor).toBeVisible();await editor.click();await editor.press('Control+A');
 await page.keyboard.insertText('### 安装验收合成记录\n\n验证覆盖安装、卸载和重装后保留资料。');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/logs/day')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'保存',exact:true}).filter({visible:true}).click();assert.equal((await response).status(),200);
 await expect(page.getByRole('button',{name:'保存',exact:true}).filter({visible:true})).toBeDisabled();
 await page.evaluate(()=>localStorage.setItem('installation-synthetic-marker','retained'));
 await close();
 const logs=(await fs.readdir(path.join(root,'data'))).filter(file=>file.endsWith('.md'));assert.ok(logs.length);
 const files=[path.join(root,'.env'),path.join(profile,'desktop.json'),...logs.map(file=>path.join(root,'data',file))];
 const hashes=await Promise.all(files.map(hash));
 const unchanged=async()=>assert.deepEqual(await Promise.all(files.map(hash)),hashes);
 passed.push('NSIS first install; default userData; synthetic log saved; normal exit releases lock');
 await installPackage(installers[1]);await unchanged();page=await launch();
 await expect(page.locator('.markdown-preview')).toContainText('安装验收合成记录');
 assert.equal(await page.evaluate(()=>localStorage.getItem('installation-synthetic-marker')),'retained');
 assert.ok(await application.evaluate(({Menu})=>Menu.getApplicationMenu().items[0].submenu.items.some(x=>x.label==='模型设置…')));
 await page.screenshot({path:path.join(evidence,'after-replacement.png')});await close();await unchanged();
 passed.push('same-version candidate replacement preserves original data/configuration/browser preferences; new menu present');
 await uninstall();await unchanged();passed.push('normal uninstall removes executable and registration, retains default data/configuration');
 await installPackage(installers[1]);page=await launch();await expect(page.locator('.markdown-preview')).toContainText('安装验收合成记录');
 assert.equal(await page.evaluate(()=>localStorage.getItem('installation-synthetic-marker')),'retained');await close();await unchanged();
 passed.push('reinstall reads retained log and browser preferences');
 await uninstall();await unchanged();
 // Only the previously absent default profile created by this run can move.
 assert.ok(allowedProfiles.includes(profile));assert.equal(root,path.join(profile,'instance'));
 const retained=path.join(path.dirname(profile),`study-log-install-evidence-${path.basename(evidence)}`);
 await assert.rejects(fs.stat(retained),{code:'ENOENT'});await fs.rename(profile,retained);
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed,installers,installerHashes:await Promise.all(installers.map(hash)),installedVersions,profile,retained,install,scope:'Silent NSIS installation and same-version replacement; no interactive wizard or version-number migration claim'},null,2));
 console.log(JSON.stringify({evidence,passed}));
}catch(error){console.error('Acceptance incomplete; preserve isolated files for diagnosis:',evidence);throw error;}
finally{if(application){const ended=application.waitForEvent('close',{timeout:60000});await application.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBoxSync=()=>1;for(const w of BrowserWindow.getAllWindows())w.close();});await ended;}}

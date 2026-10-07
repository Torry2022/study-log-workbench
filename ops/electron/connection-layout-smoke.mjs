import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test');
const evidence=path.resolve('.local',`connection-layout-${Date.now()}`);await fs.mkdir(evidence);
const launch=async profile=>{const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;return electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env});};
const close=async app=>{const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.close()));await closed;};
const chooser=async app=>{await expect.poll(()=>app.context().pages().some(p=>p.url().includes('connection.html'))).toBe(true);return app.context().pages().find(p=>p.url().includes('connection.html'));};
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'connection-layout-'));
const selectedRoot=await fs.mkdtemp(path.join(os.tmpdir(),'selected-study-data-'));
const invalidRoot=await fs.mkdtemp(path.join(os.tmpdir(),'unrelated-data-'));await fs.writeFile(path.join(invalidRoot,'keep.txt'),'synthetic unrelated file');
const pick=async(app,page,result)=>{await app.evaluate(({dialog},result)=>{dialog.showOpenDialog=async()=>result;},result);await page.getByRole('button',{name:'选择文件夹',exact:true}).click();await expect(page.locator('#choose-directory')).toBeEnabled();};
let app=await launch(profile);
try{
 const page=await chooser(app);assert.equal(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource),'system');await expect(page.locator('#root')).not.toHaveValue('');
 assert.equal(await fs.stat(path.join(profile,'instance')).catch(()=>null),null,'no instance created before choice');
 await pick(app,page,{canceled:false,filePaths:[invalidRoot]});await expect(page.locator('#notice')).toContainText('不是可用');await expect(page.locator('#root')).toHaveValue(path.join(profile,'instance'));assert.equal(await fs.readFile(path.join(invalidRoot,'keep.txt'),'utf8'),'synthetic unrelated file');
 await pick(app,page,{canceled:false,filePaths:[selectedRoot]});await expect(page.locator('#root')).toHaveValue(selectedRoot);assert.deepEqual(await fs.readdir(selectedRoot),[],'picker does not initialize directory');
 await pick(app,page,{canceled:true,filePaths:[]});await expect(page.locator('#root')).toHaveValue(selectedRoot);
 for(const theme of ['light','dark']){await app.evaluate(({nativeTheme},theme)=>nativeTheme.themeSource=theme,theme);await page.emulateMedia({colorScheme:theme});await expect.poll(()=>page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme==='dark');
  for(const width of [640,420]){await app.evaluate(({BrowserWindow},width)=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(width,w.getContentSize()[1]);},width);
   let previous;
   for(const mode of ['local','remote']){await page.locator(`[value=${mode}]`).check();
    await expect.poll(()=>page.evaluate(()=>Math.abs(innerHeight-document.querySelector('main').getBoundingClientRect().height))).toBeLessThanOrEqual(1);
    const geometry=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,bottom:innerHeight-document.querySelector('footer').getBoundingClientRect().bottom,buttonTop:document.querySelector('[type=submit]').getBoundingClientRect().top}));
    assert.ok(geometry.scroll<=geometry.height+1);assert.ok(Math.abs(geometry.bottom-24)<=1,'footer has one 24px inset');
    if(previous){assert.equal(geometry.height,previous.height,'mode switching retains window height');assert.equal(geometry.buttonTop,previous.buttonTop,'mode switching retains button position');}previous=geometry;
    const logo=page.locator(theme==='dark'?'.logo-dark':'.logo-light');await expect(logo).toHaveCSS('opacity','1');await expect.poll(()=>logo.evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true);
    await page.screenshot({path:path.join(evidence,`${theme}-${width}-${mode}.png`)});
   }
  }
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(420,360));await page.locator('[value=remote]').check();assert.ok(await page.locator('.fields').evaluate(e=>e.scrollHeight>e.clientHeight));assert.ok(await page.locator('[type=submit]').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-24));
 await page.locator('[value=local]').check();await workspacePage(app);
 const saved=JSON.parse(await fs.readFile(path.join(profile,'desktop.json'),'utf8'));assert.equal(saved.usageConfirmed,true);assert.equal(saved.root,selectedRoot);
}finally{await close(app);}
app=await launch(profile);
try{await expect.poll(()=>app.context().pages().some(p=>p.url().includes('connection.html')||/^https?:/.test(p.url())),{timeout:60000}).toBe(true);assert.equal(app.context().pages().some(p=>p.url().includes('connection.html')),false,'confirmed choice is remembered');}finally{await close(app);}
const legacy=await fs.mkdtemp(path.join(os.tmpdir(),'connection-legacy-'));
const old={root:path.join(legacy,'existing-instance'),webPort:45678,mode:'local'};
await fs.writeFile(path.join(legacy,'desktop.json'),JSON.stringify(old));app=await launch(legacy);
try{const page=await chooser(app);await expect(page.locator('#root')).toHaveValue(old.root);await pick(app,page,{canceled:false,filePaths:[selectedRoot]});await expect(page.locator('#root')).toHaveValue(selectedRoot);assert.deepEqual(JSON.parse(await fs.readFile(path.join(legacy,'desktop.json'),'utf8')),old,'opening/cancelling preserves old configuration');}finally{await close(app);}
await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,checks:['fresh choice before instance creation','light/dark local/remote at 640/420','fixed height and button position across modes','system theme with existing light/dark logos','small window scrolls fields only','directory creation/existing/invalid/cancel','local confirmation persisted','reopen confirmed profile','legacy choice without configuration rewrite']}));console.log(evidence);

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,chromium,expect}=require('@playwright/test');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'scrollbar-autohide-'))};
delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`scrollbar-autohide-${Date.now()}`);
await fs.mkdir(evidence);
const rows=[];
async function check(page,label,rootCheck=true){
 await page.mouse.move(20,20);
 await page.evaluate(()=>{
  const box=document.createElement('div');box.id='autohide-probe';
  box.style.cssText='position:fixed;left:100px;top:100px;width:240px;height:200px;overflow:auto;z-index:10000;background:var(--canvas);scroll-behavior:auto';
  const child=document.createElement('div');child.style.cssText='height:2400px;width:2400px';box.append(child);document.body.append(box);
 });
 const box=page.locator('#autohide-probe');
 const rect=await box.boundingBox();
 await expect.poll(()=>page.locator('.overlay-scrollbar.y').evaluateAll((bars,x)=>bars.findIndex(b=>!b.hidden&&Math.abs(b.getBoundingClientRect().left-x)<1),rect.x+rect.width-10)).toBeGreaterThanOrEqual(0);
 const y=page.locator('.overlay-scrollbar.y').nth(await page.locator('.overlay-scrollbar.y').evaluateAll((bars,x)=>bars.findIndex(b=>!b.hidden&&Math.abs(b.getBoundingClientRect().left-x)<1),rect.x+rect.width-10));
 const x=page.locator('.overlay-scrollbar.x').nth(await page.locator('.overlay-scrollbar.x').evaluateAll((bars,top)=>bars.findIndex(b=>!b.hidden&&Math.abs(b.getBoundingClientRect().top-top)<1),rect.y+rect.height-10));
 const opacity=bar=>bar.locator('.overlay-scrollbar-thumb').evaluate(e=>Number(getComputedStyle(e).opacity));
 for(const bar of [y,x])await expect.poll(()=>opacity(bar)).toBe(0);
 await box.evaluate(e=>{e.scrollTop=100;e.scrollLeft=100;});
 for(const bar of [y,x])await expect.poll(()=>opacity(bar)).toBeGreaterThan(.4);
 // Continuing to scroll restarts the idle timer.
 await page.waitForTimeout(700);await box.evaluate(e=>e.scrollTop+=100);
 await page.waitForTimeout(500);await expect.poll(()=>opacity(y)).toBeGreaterThan(.4);
 for(const bar of [y,x])await expect.poll(()=>opacity(bar),{timeout:3000}).toBe(0);
 await page.mouse.move(rect.x+rect.width-5,rect.y+30);
 await expect.poll(()=>opacity(y)).toBeGreaterThan(.8);
 await page.mouse.move(20,20);await expect.poll(()=>opacity(y)).toBe(0);
 await box.evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
 await page.mouse.move(rect.x+rect.width-5,rect.y+12);await page.mouse.down();
 await page.mouse.move(rect.x+rect.width+30,rect.y+100,{steps:10});
 await page.waitForTimeout(1400);await expect.poll(()=>opacity(y)).toBeGreaterThan(.8);
 assert.ok(await box.evaluate(e=>e.scrollTop)>100,`${label}: dragging still scrolls`);
 await page.mouse.up();await page.mouse.move(20,20);
 await expect.poll(()=>opacity(y),{timeout:3000}).toBe(0);
 // Actual Tab navigation enables focus-visible, which survives the idle timer.
 await y.focus();await page.keyboard.press('Tab');await expect(x).toBeFocused();
 await page.waitForTimeout(1400);await expect.poll(()=>opacity(x)).toBeGreaterThan(.8);
 await page.keyboard.press('End');assert.ok(await box.evaluate(e=>e.scrollLeft)>100);
 await x.evaluate(e=>e.blur());await expect.poll(()=>opacity(x),{timeout:3000}).toBe(0);
 assert.equal(await box.evaluate(e=>e.offsetWidth-e.clientWidth),0,`${label}: no scrollbar layout slot`);
 await box.evaluate(e=>e.remove());
 if(rootCheck){
 // Exercise the document scroll event, whose target is Document rather than the root element.
 await page.evaluate(()=>{const p=document.createElement('div');p.id='autohide-root';p.style.height='3000px';document.body.append(p);});
 const root=page.locator('.overlay-scrollbar.y').first();
 await expect(root).toBeVisible();await page.evaluate(()=>window.scrollTo({top:200,behavior:'instant'}));
 await expect.poll(()=>opacity(root)).toBeGreaterThan(.4);
 await expect.poll(()=>opacity(root),{timeout:3000}).toBe(0);
 assert.equal(await page.evaluate(()=>innerWidth-document.documentElement.clientWidth),0);
 await page.evaluate(()=>{document.querySelector('#autohide-root').remove();window.scrollTo({top:0,behavior:'instant'});});
 }
 rows.push({label,idle:true,scroll:true,hover:true,drag:true,keyboard:true,root:rootCheck,reservedWidth:0});
}
const app=await electron.launch({executablePath:process.argv[2] || er('electron'),args:process.argv[2] ? [] : [path.resolve('ops/electron')],env});
const processRef=app.process();
let browser;
try{
 const page=await workspacePage(app);
 await check(page,'Electron shared Web');
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1230,height:780}});
 const cookies=await app.evaluate(async({webContents})=>webContents.getAllWebContents().find(c=>/^http/.test(c.getURL())).session.cookies.get({name:'study_log_session'}));
 await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Lax'})));
 const web=await context.newPage();await web.goto(page.url());await expect(web.locator('.workspace')).toBeVisible();
 await check(web,'Chromium shared Web');
 await web.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await web.locator('.overlay-scrollbar-thumb').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 for(const [label,file] of [['模型设置…','settings.html'],['日志历史版本…','history.html'],['使用方式…','connection.html']]){
  await app.evaluate(({Menu},label)=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label===label).click(),label);
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith(file))).toBe(true);
  const dialog=app.windows().find(p=>p.url().endsWith(file));await dialog.waitForLoadState();
  await check(dialog,file,false);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect.poll(()=>dialog.isClosed()).toBe(true);
 }
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,packaged:!!process.argv[2],reducedMotion:true,rows},null,2));
 console.log(evidence);
}finally{
 if(browser)await browser.close();
 if(processRef.exitCode===null){const ended=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await ended;}
}

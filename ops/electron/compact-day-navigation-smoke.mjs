import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,chromium,expect}=require('@playwright/test');
const evidence=path.resolve('.local',`compact-day-navigation-${Date.now()}`);await fs.mkdir(evidence);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'compact-day-navigation-'));
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:er('electron'),args:[path.resolve('ops/electron')],env,timeout:60000});
const rows=[],errors=[];
const first='2026-06-02',second='2026-06-01';
const body=date=>`## ${date}\n\n### 合成阅读主题\n\n`+Array.from({length:90},(_,i)=>`第${i+1}段：用于验证长日志滚动后的日期导航。`).join('\n\n');
async function check(page,entry){
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const origin=new URL(page.url()).origin;
 for(const width of [1440,1100])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  await page.goto(`${origin}/study-log?date=${first}`);
  await expect(page.locator('.reader-toolbar-log h2').filter({visible:true})).toHaveText(first);
  await expect(page.locator('.compact-day-navigator')).toHaveCount(0); await expect(page.locator('.markdown-preview')).toContainText('第90段');
  await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));
  const nav=page.getByLabel('紧凑日期导航',{exact:true});await expect(nav).toBeVisible();
  assert.ok(await nav.locator('.compact-day-current span').evaluate(e=>e.scrollWidth<=e.clientWidth),'full date fits sidebar');
  assert.ok(await nav.evaluate(el=>{const a=el.getBoundingClientRect(),b=document.querySelector('.sidebar').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1&&a.top>=0;}));
  await nav.getByRole('button',{name:'选择日期',exact:true}).click();
  const search=nav.getByLabel('在紧凑导航中按标签搜索日期');await expect(search).toBeFocused();
  await search.fill('不存在的主题');await expect(nav).toContainText('没有符合条件的日志');
  await nav.getByRole('button',{name:'清空紧凑导航搜索'}).click();
  await expect(nav.locator('.day-item')).toHaveCount(2);
  const hit=await nav.locator('.day-item').first().evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+20,r.top+15));});assert.equal(hit,true);
  await page.screenshot({path:path.join(evidence,`${entry}-${width}-${theme}.png`),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(nav.locator('.compact-day-menu')).toHaveCount(0);await expect(nav.getByRole('button',{name:'选择日期',exact:true})).toBeFocused();
  await nav.getByRole('button',{name:'选择日期',exact:true}).click();await page.locator('.reader-toolbar-log h2').filter({visible:true}).click();await expect(nav.locator('.compact-day-menu')).toHaveCount(0);
  await nav.getByRole('button',{name:'下一篇',exact:true}).click();await expect(page.locator('.reader-toolbar-log h2').filter({visible:true})).toHaveText(second);
  await expect.poll(async()=>{await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));return nav.isVisible();}).toBe(true);await nav.getByRole('button',{name:'上一篇',exact:true}).click();await expect(page.locator('.reader-toolbar-log h2').filter({visible:true})).toHaveText(first);
  await expect.poll(async()=>{await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));return nav.isVisible();}).toBe(true);await page.evaluate(()=>scrollTo(0,0));await expect(nav).toHaveCount(0);
  await page.locator('.sidebar').getByRole('button',{name:'折叠左侧栏',exact:true}).click();await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));await expect(nav).toHaveCount(0);
  await page.locator('.sidebar').getByRole('button',{name:'展开左侧栏',exact:true}).click();await expect.poll(async()=>{await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));return nav.isVisible();}).toBe(true);
  rows.push({entry,width,theme,threshold:true,search:true,hitTesting:true,adjacent:true,collapsed:true});
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(`${origin}/study-log?date=${first}`);await expect(page.locator('.reader-toolbar-log h2').filter({visible:true})).toHaveText(first);
 await page.getByRole('button',{name:'源码',exact:true}).click();const editor=page.locator('.cm-content[contenteditable=true]');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\n\n未保存导航草稿');
 await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));const nav=page.getByLabel('紧凑日期导航',{exact:true});await expect(nav).toBeVisible();await nav.getByRole('button',{name:'下一篇',exact:true}).click();
 const confirm=page.getByRole('alertdialog');await expect(confirm).toBeVisible();await confirm.getByRole('button',{name:'取消',exact:true}).click();await expect(editor).toContainText('未保存导航草稿');await expect(page.locator('.reader-toolbar-log h2').filter({visible:true})).toHaveText(first);
 await editor.click();await page.keyboard.press('Control+s');await expect(page.locator('.reader-toolbar-log').filter({visible:true}).getByRole('button',{name:'保存',exact:true})).toBeDisabled();
 await page.goto(`${origin}/study-log?view=notes`);await expect(nav).toHaveCount(0);
 await page.setViewportSize({width:390,height:900});await page.goto(`${origin}/study-log?date=${first}`);await page.evaluate(()=>scrollTo({top:900,behavior:'instant'}));await expect(nav).toHaveCount(0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));rows.push({entry,draftProtected:true,otherModuleHidden:true,mobileHidden:true});
}
try{
 const page=await workspacePage(app);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
 await page.evaluate(async entries=>{for(const entry of entries){const r=await fetch('/study-log/api/logs/day',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:entry.date,content:entry.content,baseVersion:null})});if(!r.ok)throw Error('Synthetic seed failed');}},[{date:first,content:body(first)},{date:second,content:body(second)}]);
 await check(page,'electron');const browser=await chromium.launch();try{
  const context=await browser.newContext();const cookies=await app.evaluate(({webContents})=>webContents.getAllWebContents().find(c=>/^http/.test(c.getURL())).session.cookies.get({name:'study_log_session'}));
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Lax'})));
  const web=await context.newPage();await web.goto(page.url());await check(web,'browser');
 }finally{await browser.close();}
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,rows},null,2));console.log(JSON.stringify({passed:true,evidence}));
}finally{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();}

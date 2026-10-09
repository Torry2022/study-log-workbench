import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,chromium,expect}=require('@playwright/test');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'log-delete-'))};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`log-delete-${Date.now()}`);await fs.mkdir(evidence);
const app=await electron.launch({executablePath:er('electron'),args:[path.resolve('ops/electron')],env});
const errors=[],rows=[];
async function check(page,entry){
 page.on('pageerror',error=>errors.push(error.message));
 const origin=new URL(page.url()).origin;
 for(const date of ['2026-10-08','2026-10-09','2026-09-30'])assert.equal(await page.evaluate(async date=>{
  const day=(await(await fetch(`/study-log/api/logs/day?date=${date}`)).json()).day;
  return(await fetch('/study-log/api/logs/day',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,content:`### 删除验收 ${date}\n\n仅用于隔离检查。`,baseVersion:day.version})})).status;
 },date),200);
 await page.goto(`${origin}/study-log?date=2026-10-08`);
 const title=page.locator('.reader-toolbar-log h2').filter({visible:true});
 await expect(title).toHaveText('2026-10-08');
 const remove=()=>page.getByRole('button',{name:'删除当前日志',exact:true}).filter({visible:true}).click();
 const confirm=()=>page.getByRole('alertdialog').getByRole('button',{name:'删除',exact:true}).click();
 await remove();await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();await expect(title).toHaveText('2026-10-08');
 await page.route('**/api/logs/day',route=>route.request().method()==='DELETE'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'合成删除失败'})}):route.continue());
 await remove();await confirm();await expect(page.locator('.reader')).toContainText('合成删除失败');await expect(title).toHaveText('2026-10-08');await page.unroute('**/api/logs/day');
 await page.getByRole('button',{name:'源码',exact:true}).filter({visible:true}).click();await page.locator('.cm-content').press('Control+End');await page.keyboard.insertText('\n未保存的合成草稿。');
 await remove();await expect(page.getByRole('alertdialog')).toContainText('未保存修改');await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('未保存的合成草稿。');
 await remove();await confirm();await expect(title).toHaveText('2026-10-09');
 await expect(page.locator('.markdown-preview')).toContainText('删除验收 2026-10-09');assert.notEqual(new URL(page.url()).searchParams.get('date'),'2026-10-08');
 await expect(page.getByRole('button',{name:'保存',exact:true}).filter({visible:true})).toBeDisabled();await page.screenshot({path:path.join(evidence,`${entry}-remaining-day.png`)});
 await remove();await confirm();await expect(title).toHaveText('2026-09-30');await expect(page.locator('.sidebar .month-list .nav-item')).toHaveCount(1);await page.screenshot({path:path.join(evidence,`${entry}-remaining-month.png`)});
 await remove();await confirm();await expect(page.locator('.reader .workspace-state-title').filter({visible:true})).toHaveText('暂无学习日志');assert.equal(new URL(page.url()).searchParams.get('date'),null);
 await page.screenshot({path:path.join(evidence,`${entry}-empty.png`)});await page.reload();await expect(page.locator('.reader .workspace-state-title').filter({visible:true})).toHaveText('暂无学习日志');
 rows.push({entry,cancelPreserves:true,failurePreserves:true,dirtyCancelPreserves:true,remainingDay:true,remainingMonth:true,lastDayEmpty:true,reloadEmpty:true});
}
try{
 const page=await workspacePage(app);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='学习日志工作台').setContentSize(1440,900));await check(page,'electron');
 const browser=await chromium.launch();try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const cookies=await app.evaluate(async({webContents})=>webContents.getAllWebContents().find(c=>/^http/.test(c.getURL())).session.cookies.get({name:'study_log_session'}));
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Lax'})));
  const web=await context.newPage();await web.goto(page.url());await check(web,'browser');
 }finally{await browser.close();}
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,rows},null,2));console.log(evidence);
}finally{const ended=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await ended;}

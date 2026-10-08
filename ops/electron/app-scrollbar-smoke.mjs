import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'app-scrollbar-'))};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`app-scrollbar-${Date.now()}`);await fs.mkdir(evidence);
const app=await electron.launch({executablePath:er('electron'),args:[path.resolve('ops/electron')],env});
const rows=[];
// Change only synthetic overflow, keeping the real page, stylesheet and scroll owner.
async function checkPage(page,label){
 const result=await page.evaluate(()=>{
  const positions=()=>[...document.querySelectorAll('.topbar,.sidebar,.reader,.writing-inspector')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {name:e.className,left:r.left,right:r.right};});
  const initial=positions(),probe=document.createElement('div');probe.style.height='4000px';document.body.append(probe);
  const long=positions();window.scrollTo(0,500);const scroll=scrollY;
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';const locked=positions();document.body.style.overflow=previous;
  probe.remove();window.scrollTo(0,0);return {initial,long,locked,scroll,restored:positions(),gutter:getComputedStyle(document.documentElement).scrollbarGutter};
 });
 assert.equal(result.gutter,'stable',label);assert.ok(result.scroll>0,`${label}: window scrolling remains available`);
 for(const state of [result.long,result.locked,result.restored])assert.deepEqual(state,result.initial,`${label}: page/scroll-lock width changed`);
 rows.push({label,...result});
 await checkBoxes(page,label);
}
async function checkBoxes(page,label){
 const boxes=await page.evaluate(()=>{
  const results=[];
  for(const source of [...document.querySelectorAll('*')].filter(e=>e.getClientRects().length&&/auto|scroll/.test(getComputedStyle(e).overflowY))){
   // Horizontal-only strips acquire computed overflow-y:auto via CSS coupling.
   if(source instanceof HTMLTextAreaElement||source.matches('.rag-answer-mode,.stats-calendar-scroll'))continue;
   const clone=source.cloneNode(false);clone.removeAttribute('id');Object.assign(clone.style,{position:'fixed',left:'40px',top:'100px',width:'300px',height:'180px',maxHeight:'180px',minHeight:'0',display:'block',zIndex:'1000',overflowY:'auto',scrollBehavior:'auto'});
   const child=document.createElement('div');child.style.height='20px';clone.append(child);source.parentElement.append(clone);
   const short=child.getBoundingClientRect().width;child.style.height='1000px';const long=child.getBoundingClientRect().width;clone.scrollTop=100;
   results.push({name:source.className,short,long,scroll:clone.scrollTop,gutter:getComputedStyle(clone).scrollbarGutter});clone.remove();
  }return results;
 });
 for(const box of boxes){assert.equal(box.gutter,'stable',`${label}: ${box.name}`);assert.equal(box.short,box.long,`${label}: ${box.name} width shifted`);assert.ok(box.scroll>0,JSON.stringify({label,...box}));}
 rows.push({label,boxes});
}
try{
 const page=await workspacePage(app);
 for(const width of [1230,1600,420]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,780),width);
  for(const theme of ['日间模式','夜间模式']){
   if(width===420)await page.evaluate(theme=>{document.documentElement.dataset.theme=theme==='日间模式'?'light':'dark';},theme);
   else{await page.getByRole('button',{name:'切换主题模式',exact:true}).click();await page.locator('.theme-popover').getByRole('button',{name:theme,exact:true}).click();}
   for(const [name,view] of [['日志','log'],['随记','notes'],['收藏','favorites'],['问答','qa'],['统计','stats']]){
    if(view==='log'&&width!==420){
     const back=page.locator('.reader-toolbar').getByRole('button',{name:'日志',exact:true});if(await back.count())await back.click();
    }else{
     const nav=page.locator(width===420?'.mobile-bottom-nav':'.topbar-actions');await nav.getByRole('button',{name,exact:true}).click();
    }
    await expect(page.locator(`.app-shell.view-${view}`)).toBeVisible();await page.waitForTimeout(220);
    await checkPage(page,`${width}/${theme}/${view}`);
    await page.screenshot({path:path.join(evidence,`${width}-${theme}-${view}.png`)});
   }
  }
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1230,780));
 await page.locator('.reader-toolbar-stats').getByRole('button',{name:'日志',exact:true}).click();
 await page.getByRole('button',{name:'今天',exact:true}).click();await expect(page.locator('.cm-content')).toBeVisible();
 await page.locator('.cm-content').click();await page.keyboard.insertText('### 合成记录\n\n'+('保留条件与上下文的短记录。\n\n').repeat(60));
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/logs/day')&&r.request().method()==='PUT');
 await page.locator('.reader-toolbar-log').getByRole('button',{name:'保存',exact:true}).click();assert.equal((await saved).status(),200);
 await page.locator('.reader-toolbar-log').getByRole('button',{name:'浏览',exact:true}).click();await expect(page.locator('.markdown-preview h3')).toHaveText('合成记录');
 await checkPage(page,'saved long log');
 await page.locator('.reader-toolbar-log').getByRole('button',{name:'日志历史版本',exact:true}).click();await expect(page.locator('.backup-dialog')).toBeVisible();
 await checkBoxes(page,'backup dialog');await page.getByRole('button',{name:'关闭日志历史版本',exact:true}).click();await expect(page.locator('.backup-dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'展开右侧栏',exact:true}).click();await page.getByRole('button',{name:'管理生成方案',exact:true}).click();await expect(page.locator('.generation-presets-dialog')).toBeVisible();
 await checkBoxes(page,'generation presets');await page.getByRole('button',{name:'关闭生成方案',exact:true}).click();await expect(page.locator('.generation-presets-dialog')).toHaveCount(0);
 for(const [label,file] of [['模型设置…','settings.html'],['日志历史版本…','history.html'],['使用方式…','connection.html']]){
  await app.evaluate(({Menu},label)=>Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label===label).click(),label);
  await expect.poll(()=>app.windows().some(p=>p.url().endsWith(file))).toBe(true);
  const dialog=app.windows().find(p=>p.url().endsWith(file));await dialog.waitForLoadState();
  // These windows deliberately lock the document and scroll their fields instead.
  const fields=dialog.locator(file==='connection.html'?'.fields':'.settings-fields');
  const metrics=await fields.evaluate(e=>{const probe=document.createElement('div');probe.style.height='10px';e.append(probe);const before=probe.getBoundingClientRect().width;probe.style.height='4000px';const after=probe.getBoundingClientRect().width;e.scrollTop=100;const scroll=e.scrollTop;probe.remove();return {before,after,scroll,gutter:getComputedStyle(e).scrollbarGutter};});
  assert.equal(metrics.gutter,'stable');assert.equal(metrics.before,metrics.after);assert.ok(metrics.scroll>0);rows.push({label,metrics});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect.poll(()=>dialog.isClosed()).toBe(true);
 }
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,rows},null,2));console.log(evidence);
}finally{if(app.process().exitCode===null){const ended=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await ended;}}

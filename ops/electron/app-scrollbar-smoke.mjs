import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,chromium,expect}=require('@playwright/test');
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
  probe.remove();window.scrollTo(0,0);return {initial,long,locked,scroll,restored:positions(),reserved:innerWidth-document.documentElement.clientWidth,gutter:getComputedStyle(document.documentElement).scrollbarGutter};
 });
 assert.equal(result.reserved,0,`${label}: root scrollbar reserves space`);assert.ok(result.scroll>0,`${label}: window scrolling remains available`);
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
   results.push({name:source.className,short,long,scroll:clone.scrollTop,reserved:clone.offsetWidth-clone.clientWidth-parseFloat(getComputedStyle(clone).borderLeftWidth)-parseFloat(getComputedStyle(clone).borderRightWidth),gutter:getComputedStyle(clone).scrollbarGutter});clone.remove();
  }return results;
 });
 for(const box of boxes){assert.equal(box.reserved,0,`${label}: ${box.name} reserves scrollbar space`);assert.equal(box.short,box.long,`${label}: ${box.name} width shifted`);assert.ok(box.scroll>0,JSON.stringify({label,...box}));}
 rows.push({label,boxes});
}
try{
 const page=await workspacePage(app);
 // A visible overlay thumb must still accept pointer dragging, not merely hide.
 await page.evaluate(()=>{const box=document.createElement('div');box.id='overlay-drag-probe';box.style.cssText='position:fixed;left:300px;top:150px;width:240px;height:200px;overflow:auto;z-index:10000;background:var(--canvas)';const child=document.createElement('div');child.style.cssText='height:2400px;width:600px';box.append(child);document.body.append(box);});
 const dragBox=page.locator('#overlay-drag-probe');const rect=await dragBox.boundingBox();
 await page.mouse.move(rect.x+rect.width-4,rect.y+12);await page.waitForTimeout(300);
 await page.screenshot({path:path.join(evidence,'overlay-scrollbar-thumb.png')});
 await page.mouse.down();await page.mouse.move(rect.x+rect.width-4,rect.y+110,{steps:12});await page.mouse.up();
 assert.ok(await dragBox.evaluate(e=>e.scrollTop)>100,'overlay vertical thumb remains draggable');
 await dragBox.evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
 await page.mouse.move(rect.x+12,rect.y+rect.height-4);await page.waitForTimeout(300);
 await page.mouse.down();await page.mouse.move(rect.x+130,rect.y+rect.height-4,{steps:12});await page.mouse.up();
 assert.ok(await dragBox.evaluate(e=>e.scrollLeft)>50,'overlay horizontal thumb remains draggable');
 await dragBox.evaluate(e=>e.remove());
 rows.push({overlayThumbDrag:true});
 for(const width of (process.env.FOCUSED ? [1230] : [1180,1230,1280,1600,420])){
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
    if(width===1230 && theme==='日间模式'){
     await page.evaluate(()=>{const probe=document.createElement('div');probe.id='back-top-probe';probe.style.height='3000px';document.body.append(probe);window.scrollTo(0,500);});
     const back=page.getByRole('button',{name:/返回顶部，当前滚动进度/});await expect(back).toBeVisible();
     if(view==='log'){await page.mouse.move(10,10);await expect(back).toBeHidden({timeout:4000});await page.evaluate(()=>window.scrollBy(0,60));await expect(back).toBeVisible();await page.screenshot({path:path.join(evidence,'back-to-top.png')});}
     await back.click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);await page.evaluate(()=>document.querySelector('#back-top-probe').remove());
     rows.push({backToTop:view,passed:true});
    }
    if(width>=1024){const sidebar=await page.locator('.sidebar').filter({visible:true}).boundingBox();assert.ok(Math.abs(sidebar.width-((await page.evaluate(()=>innerWidth))<=1279?220:260))<1,`${width}/${view}: inconsistent sidebar width ${sidebar.width}`);}
    await page.screenshot({path:path.join(evidence,`${width}-${theme}-${view}.png`)});
   }
  }
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1230,780));
 await page.locator('.reader-toolbar-stats').getByRole('button',{name:'日志',exact:true}).click();
 await page.getByRole('button',{name:'今天',exact:true}).click();
 await page.locator('.reader-toolbar-log').getByRole('button',{name:'源码',exact:true}).click();await expect(page.locator('.cm-content')).toBeVisible();
 await page.locator('.cm-content').click();await page.keyboard.press('Control+A');await page.keyboard.insertText('### 合成记录\n\n'+('保留条件与上下文的短记录。\n\n').repeat(60));
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/logs/day')&&r.request().method()==='PUT');
 await page.locator('.reader-toolbar-log').getByRole('button',{name:'保存',exact:true}).click();assert.equal((await saved).status(),200);
 await page.locator('.cm-scroller').evaluate(e=>e.scrollTop=500);await page.evaluate(()=>window.scrollTo(0,300));
 await expect(page.getByRole('button',{name:/返回顶部，当前滚动进度/})).toBeVisible();
 await page.getByRole('button',{name:/返回顶部，当前滚动进度/}).click();
 await expect.poll(()=>page.locator('.cm-scroller').evaluate(e=>e.scrollTop)).toBe(0);
 rows.push({editorBackToTop:true});
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
  const metrics=await fields.evaluate(e=>{const probe=document.createElement('div');probe.style.height='10px';e.append(probe);const before=probe.getBoundingClientRect().width;probe.style.height='4000px';const after=probe.getBoundingClientRect().width;e.scrollTop=100;const scroll=e.scrollTop;probe.remove();return {before,after,scroll,reserved:e.offsetWidth-e.clientWidth-parseFloat(getComputedStyle(e).borderLeftWidth)-parseFloat(getComputedStyle(e).borderRightWidth),gutter:getComputedStyle(e).scrollbarGutter};});
  assert.equal(metrics.reserved,0);assert.equal(metrics.before,metrics.after);assert.ok(metrics.scroll>0);rows.push({label,metrics});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect.poll(()=>dialog.isClosed()).toBe(true);
 }
 // Ordinary browser uses the same Web build and an isolated copy of the test login.
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1230,height:780}});
  const cookies=await app.evaluate(async({webContents})=>{const contents=webContents.getAllWebContents().find(c=>/^http/.test(c.getURL()));return contents.session.cookies.get({name:'study_log_session'});});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Lax'})));
  const web=await context.newPage();await web.goto(page.url());await expect(web.locator('.workspace')).toBeVisible();await expect(web.locator('html')).toHaveClass(/overlay-scrollbars-ready/);await expect(web.locator('.markdown-preview h3')).toHaveText('合成记录');await web.evaluate(()=>document.fonts.ready);
  for(const [name,view] of [['日志','log'],['随记','notes'],['收藏','favorites'],['问答','qa'],['统计','stats']]){
   if(view!=='log')await web.locator('.topbar-actions').getByRole('button',{name,exact:true}).click();
   await expect(web.locator(`.view-${view}`)).toBeVisible();await checkPage(web,`browser/${view}`);
   await expect.poll(()=>web.locator('.sidebar').filter({visible:true}).evaluate(e=>e.getBoundingClientRect().width)).toBe(220);
   await web.evaluate(()=>{const e=document.createElement('div');e.id='web-scroll-probe';e.style.height='3000px';document.body.append(e);window.scrollTo(0,500);});
   await web.getByRole('button',{name:/返回顶部，当前滚动进度/}).click();await expect.poll(()=>web.evaluate(()=>scrollY),{message:`browser ${view} returns to top`}).toBe(0);
   await web.evaluate(()=>document.querySelector('#web-scroll-probe').remove());
  }
  await web.locator('.stats-shell-embedded').evaluate(e=>{const child=document.createElement('div');child.style.height='3000px';e.append(child);e.scrollTop=500;});
  await web.getByRole('button',{name:/返回顶部，当前滚动进度/}).click();await expect.poll(()=>web.locator('.stats-shell-embedded').evaluate(e=>e.scrollTop)).toBe(0);
  await web.screenshot({path:path.join(evidence,'browser-stats.png')});rows.push({browserSidebarAndBackToTop:true});
 }finally{await browser.close();}
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,rows},null,2));console.log(evidence);
}finally{if(app.process().exitCode===null){const ended=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await ended;}}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {DesktopManager} from './desktop/manager.mjs';
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const evidence=path.resolve(process.argv[2]||`.local/initial-empty-${Date.now()}`);
await fs.mkdir(evidence,{recursive:true});
const manager=new DesktopManager({packageRoot:path.join(evidence,'program'),webRoot:path.resolve('study-log-web'),mcpRoot:path.resolve('study-log-mcp')});
const password=crypto.randomBytes(20).toString('hex'),root=path.join(evidence,'synthetic-instance');
const browser=await chromium.launch();
const results=[];
try{
 await manager.select({root,create:true,password});
 const data=path.join(root,'data'),examples=(await fs.readdir(data)).filter(name=>name.endsWith('_学习日志.md'));
 assert.equal(examples.length,1);await fs.unlink(path.join(data,examples[0]));
 const running=await manager.start();
 const context=await browser.newContext();
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(running.url);await page.getByLabel('访问密码').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.locator('.workspace').waitFor();
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const mobile=width<1024;
  for(const [view,label] of [['log','日志'],['notes','随记'],['favorites','收藏'],['qa','问答'],['stats','统计']]){
   if(mobile)await page.locator('.mobile-bottom-nav').getByRole('button',{name:label,exact:true}).click();
   else if(view==='log') { if(!await page.locator('.app-shell.view-log').count())await page.locator('.reader').getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click(); }
   else await page.locator('.topbar-actions').getByRole('button',{name:label,exact:true}).click();
   await expect(page.locator(`.app-shell.view-${view}`)).toBeVisible();
   const empty=page.locator('.reader .workspace-state-module').filter({visible:true});await expect(empty).toHaveCount(1);
   await expect(empty.locator('.workspace-state-description')).toBeVisible();
   if(view!=='log'||mobile){const nav=page.locator(mobile?'.mobile-bottom-nav':'.topbar-actions');await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);const current=nav.locator('[aria-current="page"]');const other=nav.locator('button:not([aria-current])').first();assert.notEqual(await current.evaluate(e=>getComputedStyle(e).backgroundColor),await other.evaluate(e=>getComputedStyle(e).backgroundColor));}
   await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const geometry=await empty.evaluate(e=>{const t=e.querySelector('.workspace-state-title'),d=e.querySelector('.workspace-state-description'),icon=e.querySelector('.workspace-state-icon');return {title:t.textContent,font:getComputedStyle(t).fontSize,fontFamily:getComputedStyle(t).fontFamily,weight:getComputedStyle(t).fontWeight,descriptionSize:getComputedStyle(d).fontSize,iconWidth:icon.getBoundingClientRect().width,top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height};});
   const expectedTitles={log:'暂无学习日志',notes:'暂无随记',favorites:'暂无收藏',qa:'暂无可参考的日志',stats:'暂无统计数据'};assert.equal(geometry.title,expectedTitles[view]);
   assert.equal(geometry.font,'14px');assert.match(geometry.fontFamily,/Inter/);assert.equal(geometry.descriptionSize,'13px');assert.equal(geometry.iconWidth,20);
   await page.screenshot({animations:"disabled",path:path.join(evidence,`${width}-${theme}-${view}.png`),fullPage:true});
   if(mobile){await page.getByRole('button',{name:{log:'打开日志导航',notes:'打开随记筛选',favorites:'打开收藏筛选',qa:'打开问答历史',stats:'打开统计导航'}[view],exact:true}).click();}
   if(view==='log'){
    await expect(page.locator('[data-log-section="months"] .workspace-state-title')).toHaveText('暂无月份记录');
    await expect(page.locator('[data-log-section="dates"] .workspace-state-title')).toHaveText('暂无学习日志');
   }
   if(view==='qa')await expect(page.locator('.sidebar .workspace-state-title')).toHaveText('暂无历史问答');
   if(view==='log'||view==='qa'){const headings=page.locator('.sidebar .workspace-state-heading');assert.ok(await headings.count()>0);await expect(headings.first()).toBeVisible();}
   if(mobile){await page.screenshot({animations:"disabled",path:path.join(evidence,`${width}-${theme}-${view}-sidebar.png`),fullPage:true});await page.getByRole('button',{name:'关闭左侧导航',exact:true}).click();}
   results.push({width,theme,view,...geometry});
  }
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.sidebar').getByRole('button',{name:'分类管理',exact:true}).click();
 await expect(page.locator('.reader')).toContainText('暂无可分类的小节');
 await page.screenshot({animations:'disabled',path:path.join(evidence,'empty-taxonomy.png'),fullPage:true});
 await page.getByRole('button',{name:'月度复盘',exact:true}).click();
 // Search and AI prerequisites on a truly empty instance.
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.reader').getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click();
 const search=page.getByRole('combobox',{name:'搜索全部日志',exact:true});await search.fill('合成关键词');await search.press('Enter');
 await expect(page.locator('.search-popover')).toContainText('暂无学习日志');
 await page.screenshot({animations:"disabled",path:path.join(evidence,'empty-search.png'),fullPage:true});
 await page.getByRole('button',{name:'清空搜索',exact:true}).click();await search.press('Escape');
 await page.getByRole('button',{name:'展开右侧栏',exact:true}).click();
 await expect(page.locator('.writing-panel .workspace-state-title')).toHaveText('未选择日志');
 await expect(page.getByRole('button',{name:'生成日志草稿',exact:true})).toBeDisabled();
 await page.screenshot({animations:"disabled",path:path.join(evidence,'empty-writing.png'),fullPage:true});
 await page.locator('.inspector-tabs').getByRole('button',{name:'重点标注',exact:true}).click();
 await expect(page.locator('.highlight-panel .workspace-state-title')).toHaveText('未选择日志');
 await page.screenshot({animations:"disabled",path:path.join(evidence,'empty-highlight.png'),fullPage:true});
 await page.getByRole('button',{name:'折叠右侧栏',exact:true}).click();
 // A failed history request is not an empty history, including collapsed navigation.
 await page.setViewportSize({width:1440,height:900});
 await page.route('**/api/rag/sessions?*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成历史读取故障'})}));
 await page.locator('.topbar-actions').getByRole('button',{name:'问答',exact:true}).click();
 await expect(page.locator('.sidebar .workspace-state-error')).toBeVisible();
 await expect(page.locator('.sidebar')).not.toContainText('暂无历史问答');
 await page.locator('.sidebar').getByRole('button',{name:'折叠左侧栏',exact:true}).click();
 await page.getByRole('button',{name:'最近问答',exact:true}).click();
 await expect(page.locator('.sidebar .workspace-state-error').filter({visible:true})).toBeVisible();
 await page.getByRole('button',{name:'展开左侧栏',exact:true}).click();
 await page.unroute('**/api/rag/sessions?*');
 await page.locator('.sidebar').getByRole('button',{name:'重试',exact:true}).click();
 await expect(page.locator('.sidebar .workspace-state-title')).toHaveText('暂无历史问答');
 // First real record: leave empty state, save, then verify month/day navigation appears.
 await page.locator('.reader').getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click();
 await expect(page.locator('.reader').getByRole('button',{name:'导出',exact:true}).filter({visible:true})).toBeDisabled();
 await expect(page.locator('.reader').getByRole('button',{name:'源码',exact:true}).filter({visible:true})).toBeDisabled();
 await page.getByRole('button',{name:'今天',exact:true}).filter({visible:true}).click();
 const editor=page.locator('.cm-content').filter({visible:true});await expect(editor).toBeVisible();
 await editor.click();await page.keyboard.press('Control+a');await page.keyboard.insertText('### 空实例首篇合成记录\n\n仅用于界面验收。');
 await page.getByRole('button',{name:'保存',exact:true}).filter({visible:true}).click();
 await expect(page.locator('[data-log-section="months"] .nav-item')).toHaveCount(1);
 await expect(page.locator('[data-log-section="dates"] .day-item')).toHaveCount(1);
 await page.getByRole('button',{name:'浏览',exact:true}).filter({visible:true}).click();
 await expect(page.locator('.markdown-preview')).toContainText('仅用于界面验收。');
  await page.getByRole('textbox',{name:'按日期标签搜索日期',exact:true}).fill('不存在的合成标签');
 await expect(page.locator('[data-log-section="dates"] .workspace-state-title')).toHaveText('没有符合条件的日志');
 await page.getByRole('button',{name:'清空日期搜索',exact:true}).click();
 await expect(page.locator('[data-log-section="dates"] .day-item')).toHaveCount(1);
 assert.deepEqual(errors,[]);
 await manager.stop();
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({passed:true,webBuild:(await fs.readFile('study-log-web/.next-build-cache/BUILD_ID','utf8')).trim(),results,historyRetry:true,firstRecord:true,paidCalls:0,scope:'Fresh synthetic instance, independent Playwright; 1440/390 light/dark, five modules and mobile drawers.'},null,2));
 console.log(JSON.stringify({passed:true,evidence,states:results.length}));
}finally{await browser.close();await manager.shutdown();}

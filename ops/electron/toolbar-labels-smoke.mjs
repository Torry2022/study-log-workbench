import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url)),er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'toolbar-labels-'))};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`toolbar-labels-${Date.now()}`);await fs.mkdir(evidence);
const app=await electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env});
try{
 const page=await workspacePage(app);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,900));
 await page.getByRole('button',{name:'今天',exact:true}).click();
 const rows=[];
 for(const mode of ['浏览','源码']){
  await page.locator('.reader-toolbar-log .view-mode-button').filter({hasText:mode}).click();
  const more=page.getByRole('button',{name:'更多操作',exact:true});
  if(mode==='浏览')await expect(more).toBeHidden();
  else{
   await more.click();
   const menu=page.locator('.log-toolbar-popover');await expect(menu).toBeVisible();
   await expect(menu.getByRole('button',{name:'大纲',exact:true})).toBeVisible();
   await expect(menu.getByRole('button',{name:'AI 工具',exact:true})).toHaveCount(0);
   for(const button of await menu.locator('button:visible').all())assert.equal(await button.locator('svg').count(),1,'menu actions use icon and text');
   await page.screenshot({path:path.join(evidence,`${mode}-more.png`)});
   await more.press('Escape');
  }
  if(mode==='源码'){
   const inset=await page.locator('.editor-date-line').evaluate(line=>{const a=line.getBoundingClientRect(),b=line.querySelector('.markdown-edit-trigger').getBoundingClientRect();return {top:b.top-a.top,bottom:a.bottom-b.bottom,height:b.height};});
   assert.ok(inset.top>=6&&inset.bottom>=6&&inset.height===30,JSON.stringify(inset));
   await page.getByRole('button',{name:'编辑 Markdown'}).click();
   for(const button of await page.locator('.markdown-edit-options button').all())assert.equal(await button.locator('svg').count(),1);
   await page.screenshot({path:path.join(evidence,'markdown-edit.png')});
   await page.getByRole('button',{name:'编辑 Markdown'}).press('Escape');
  }
  for(const expanded of [false,true]){
   if(expanded)await page.getByRole('button',{name:'展开右侧栏',exact:true}).click();
   for(const width of [1912,1600,1500,1450,1400,1350,1300,1250,1200,1150,1100,1050,1024]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(width);
    // Wait for sidebar transitions to stop before comparing slot geometry.
    await page.waitForTimeout(250);
    const row=await page.locator('.reader-toolbar-log').evaluate(e=>{
     const rect=e.getBoundingClientRect(),identity=e.querySelector('.reader-log-identity').getBoundingClientRect(),controls=e.querySelector('.reader-log-controls').getBoundingClientRect();
     const selectors=['.reader-navigator-desktop .day-nav-button','.view-mode-button','.toolbar-save-button','.log-action-refresh','.log-action-export > button','.log-action-backup','.log-action-delete'];
     return {width:rect.width,height:rect.height,overlap:identity.right>controls.left+1&&identity.bottom>controls.top+1,overflow:controls.right>rect.right+1,labels:selectors.map(selector=>{const button=e.querySelector(selector);return button.getClientRects().length&&getComputedStyle(button).display!=='none'?parseFloat(getComputedStyle(button).fontSize)>0:null;})};
    });
    rows.push({mode,expanded,window:width,...row});
    const icons=await page.locator('.reader-toolbar-log').evaluate(e=>[...e.querySelectorAll('.day-toolbar-actions > .button, .day-toolbar-actions .export-menu > .button, .view-mode-button, .day-nav-button')].filter(button=>button.getClientRects().length&&getComputedStyle(button).display!=='none'&&(parseFloat(getComputedStyle(button).fontSize)===0||button.closest('.log-toolbar-more'))).map(button=>({name:button.getAttribute('aria-label')||button.title,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})));
    for(const icon of icons)assert.ok(Math.abs(icon.width-icon.height)<1,JSON.stringify({window:width,mode,expanded,icon}));
    if(await more.isVisible()){
     await more.click();
     await expect(page.locator('.log-toolbar-popover').getByRole('button',{name:'AI 工具',exact:true})).toHaveCount(0);
     for(const [headerSelector,menuSelector] of [['.log-action-refresh','.log-overflow-refresh'],['.log-action-backup','.log-overflow-backup'],['.log-action-delete','.log-overflow-delete']])assert.notEqual(await page.locator('.reader-toolbar-log '+headerSelector).isVisible(),await page.locator('.log-toolbar-popover '+menuSelector).isVisible(),JSON.stringify({width,mode,expanded,headerSelector}));
     assert.ok(await page.locator('.log-toolbar-popover button:visible').count(),'more menu must have an action');
     await more.press('Escape');
    }else{
     assert.equal(mode,'浏览');
     for(const selector of ['.log-action-refresh','.log-action-backup','.log-action-delete'])await expect(page.locator('.reader-toolbar-log '+selector)).toBeVisible();
    }
    assert.equal(row.overlap,false,JSON.stringify(rows.at(-1)));assert.equal(row.overflow,false,JSON.stringify(rows.at(-1)));
    assert.ok(row.height<105,'toolbar must remain a single row: '+JSON.stringify(rows.at(-1)));
    const visible=row.labels.filter(v=>v!==null);let compact=false;for(const label of visible){if(!label)compact=true;else assert.equal(compact,false,'lower-priority text survived before higher priority: '+JSON.stringify(rows.at(-1)));}
    if([1500,1300,1100].includes(width))await page.screenshot({path:path.join(evidence,`${mode}-${expanded}-${width}.png`)});
   }
   if(expanded)await page.getByRole('button',{name:'折叠右侧栏',exact:true}).click();
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,900));
  }
 }
 assert.ok(new Set(rows.filter(r=>r.labels.some(Boolean)).map(r=>JSON.stringify(r.labels))).size>=5,'multiple label stages');
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(rows,null,2));console.log(evidence);
}finally{if(app.process().exitCode===null){const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await closed;}}

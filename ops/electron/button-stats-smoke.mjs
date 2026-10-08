import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));
const er=createRequire(new URL('./package.json',import.meta.url));
const {_electron:electron,expect}=require('@playwright/test'),sharp=require('sharp');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'button-stats-'))};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`button-stats-${Date.now()}`);await fs.mkdir(evidence);
const app=await electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env});
const failures=[],rows=[];
try{
 const page=await workspacePage(app);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1230,820));
 for(const theme of ['日间模式','夜间模式']){
  await page.getByRole('button',{name:'切换主题模式',exact:true}).click();await page.locator('.theme-popover').getByRole('button',{name:new RegExp(theme)}).click();
  await page.waitForTimeout(250);await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.locator('.date-create button').evaluate(button=>{
   const r=button.getBoundingClientRect(),text=[...button.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()),range=document.createRange();range.selectNode(text);const t=range.getBoundingClientRect();
   return {center:r.top+r.height/2,text:{x:t.x,y:t.y,width:t.width,height:t.height},ink:getComputedStyle(button).color.match(/[\d.]+/g).slice(0,3).map(Number)};
  });
  const screenshot=await page.screenshot({path:path.join(evidence,`${theme}-buttons.png`)}),{data,info}=await sharp(screenshot).raw().toBuffer({resolveWithObject:true});let top=Infinity,bottom=-Infinity;
  for(let y=Math.floor(geometry.text.y);y<Math.ceil(geometry.text.y+geometry.text.height);y++)for(let x=Math.floor(geometry.text.x);x<Math.ceil(geometry.text.x+geometry.text.width);x++){
   const i=(y*info.width+x)*info.channels;if(geometry.ink.reduce((sum,value,c)=>sum+Math.abs(data[i+c]-value),0)<100){top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  const offset=(top+bottom+1)/2-geometry.center;rows.push({theme,button:'新建',inkCenterOffset:offset});if(!Number.isFinite(offset)||Math.abs(offset)>.55)failures.push(`新建字形偏移 ${offset}px (${theme})`);
  const buttons=await page.locator('.date-create button, .sidebar .button.full, .topbar-actions .button').evaluateAll(buttons=>buttons.filter(b=>b.getClientRects().length).map(b=>{const s=getComputedStyle(b);return {text:b.textContent.trim(),fontSize:parseFloat(s.fontSize),lineHeight:parseFloat(s.lineHeight)};}));
  for(const button of buttons)if(!Number.isFinite(button.lineHeight)||Math.abs(button.lineHeight/button.fontSize-1.4)>.01)failures.push(`按钮行高未统一: ${JSON.stringify(button)}`);
 }
 const geometry=()=>page.evaluate(()=>{const root=document.documentElement,bar=document.querySelector('.topbar').getBoundingClientRect(),sidebar=document.querySelector('.sidebar').getBoundingClientRect();return {rootWidth:root.clientWidth,rootOverflow:root.scrollHeight>innerHeight+1,barRight:bar.right,sidebarRight:sidebar.right};});
 const initial=await geometry();
 await page.locator('.topbar-actions').getByRole('button',{name:'统计',exact:true}).click();await expect(page.getByText('暂无统计数据',{exact:true})).toBeVisible();
 const empty=await geometry();if(await page.locator('.sidebar-filter-heading .section-title svg').count()!==1)failures.push('统计导航缺少图标');
 await page.locator('.reader-toolbar-stats').getByRole('button',{name:'日志',exact:true}).click();await page.getByRole('button',{name:'今天',exact:true}).click();
 const editor=page.locator('.cm-content');await expect(editor).toBeVisible();await editor.click();await page.keyboard.insertText('### 合成记录\n\n学习了一个概念，并保留它的适用条件。');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/logs/day')&&r.request().method()==='PUT');await page.locator('.reader-toolbar-log').getByRole('button',{name:'保存',exact:true}).click();assert.equal((await saved).status(),200);await expect(page.locator('.toolbar-save-button')).toBeDisabled();
 await page.locator('.topbar-actions').getByRole('button',{name:'统计',exact:true}).click();await expect(page.locator('.stats-overview')).toBeVisible();
 const full=await geometry();rows.push({initial,empty,full});
 for(const state of [empty,full])if(state.rootOverflow||state.rootWidth!==initial.rootWidth||Math.abs(state.barRight-initial.barRight)>1||Math.abs(state.sidebarRight-empty.sidebarRight)>1)failures.push(`统计切换挤动外壳: ${JSON.stringify(state)}`);
 const scroll=page.locator('.stats-shell-embedded');const metrics=await scroll.evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight}));
 if(metrics.scroll<=metrics.client)failures.push('统计内容未独立滚动');else{await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);await expect.poll(()=>scroll.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await expect(page.locator('.stats-topic-ranking')).toBeVisible();}
 await page.screenshot({path:path.join(evidence,'stats-bottom.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1600,820));await scroll.evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(evidence,'stats-wide.png')});
 await page.locator('.sidebar').getByRole('button',{name:'折叠左侧栏',exact:true}).click();await expect(page.getByRole('button',{name:'统计月份',exact:true})).toBeVisible();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(420,820));await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(420);await expect(page.locator('.mobile-bottom-nav')).toBeVisible();await expect(page.locator('.stats-overview')).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'narrow view must remain horizontally contained');await page.screenshot({path:path.join(evidence,'stats-narrow.png')});
 await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({rows,failures,metrics},null,2));console.log(evidence);assert.deepEqual(failures,[]);
}finally{if(app.process().exitCode===null){const ended=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await ended;}}

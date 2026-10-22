// Actual log/Q&A-source entrypoints. Only isolated synthetic files; no model requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { initialize } from './instance.mjs';
const repo=path.resolve(import.meta.dirname,'..'),root=path.join(repo,'.local',`log-toolbar-${Date.now()}`),instance=path.join(root,'instance');
await fs.mkdir(root,{recursive:true});await initialize(instance);
const env=parseEnv(await fs.readFile(path.join(instance,'.env'),'utf8'));
const source=['## 2026-10-22','### 开头','[[2026-10-21|前一天]]',...Array(20).fill('合成阅读材料。'),'### 位置检查',...Array(40).fill('合成阅读位置。'),'---','## 2026-10-21','### 开头','前一天合成材料。'].join('\n\n');
const sourceFile=path.join(instance,'data/2026-10_学习日志.md');await fs.writeFile(sourceFile,source);
const {chromium,webkit,expect}=createRequire(new URL('../study-log-web/package.json',import.meta.url))('@playwright/test');
const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});
const safe=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,...env,LOG_ROOT:path.join(instance,'data'),BACKUP_ROOT:path.join(instance,'backups'),CHAT_API_KEY:'',CHAT_LIGHT_API_KEY:''}});
let log='',browser,page;server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);
const base=`http://127.0.0.1:${port}/study-log`,report={root,layouts:[],checks:[],probes:[],menuFocus:[],errors:[],paidModelCalls:0};
const record=name=>{report.checks.push(name);console.log('PASS '+name);};
try{
 await expect.poll(()=>fetch(base).then(r=>r.ok).catch(()=>false),{timeout:30000}).toBe(true);
 for(const[engine,launcher]of[['chromium',chromium],['webkit',webkit]])for(const theme of['light','dark']){
  const label=engine+'-'+theme;if(process.env.LOG_TOOLBAR_ONLY&&process.env.LOG_TOOLBAR_ONLY!==label)continue;
  browser=await launcher.launch();page=await browser.newPage({viewport:{width:1920,height:1000},colorScheme:theme});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(theme=>localStorage.setItem('study-log-theme',theme),theme);await page.goto(base+'?date=2026-10-22');await page.getByLabel('访问密码').fill(env.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.reader-content .markdown-preview').filter({visible:true})).toContainText('合成阅读材料');
  const sid=randomUUID(),response=await page.request.post(base+'/api/rag/sessions',{data:{id:sid,mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:randomUUID(),role:'user',content:'合成问题',status:'complete'},{id:randomUUID(),role:'assistant',content:'合成回答',status:'complete',citations:[{sourceId:'S1',date:'2026-10-22',month:'2026-10',fileName:'2026-10_学习日志.md',heading:'开头',headingIndex:0,chunkId:'synthetic-toolbar',contentHash:'synthetic-toolbar',excerpt:'合成阅读材料。'}]}]}});assert.equal(response.status(),200,await response.text());
  const toolbar=page.locator('.reader-toolbar-log');
  const settled=async()=>{await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.workspaceTransition||null)).toBe(null);await expect.poll(()=>page.evaluate(()=>document.querySelector('.workspace').getAnimations().filter(a=>a.playState==='running').length)).toBe(0);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
  const mode=async value=>{const select=toolbar.locator('.log-mode-select');if(await select.isVisible())await select.selectOption(value);else await toolbar.locator('.reader-mode-actions').getByRole('button',{name:{preview:'浏览',source:'源码',split:'分屏'}[value],exact:true}).click();await settled();};
  const inspect=()=>toolbar.evaluate(toolbar=>{
   const rect=toolbar.getBoundingClientRect(),identity=toolbar.querySelector('.reader-log-identity').getBoundingClientRect(),controls=toolbar.querySelector('.reader-log-controls'),bounds=controls.getBoundingClientRect();
   const buttons=[...toolbar.querySelectorAll('.reader-navigator-desktop .day-nav-button,.reader-secondary-actions button,.reader-mode-actions button,.log-mode-select,.day-toolbar-actions > button,.log-action-export > button,.log-toolbar-more > button')].filter(e=>e.getClientRects().length);
   const actions=buttons.map(e=>{const r=e.getBoundingClientRect();return{name:e.getAttribute('aria-label')||e.textContent.trim(),text:e.textContent.trim(),x:r.x,right:r.right,y:r.y,height:r.height,width:r.width,font:parseFloat(getComputedStyle(e).fontSize),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
   const layout=controls.dataset.toolbarLayout||'',tokens=layout.split(' ').filter(Boolean);let previousFits=null,previousGroups=null;
   if(tokens.length){controls.dataset.toolbarLayout=tokens.slice(0,-1).join(' ');const previousButtons=[...controls.querySelectorAll('.reader-navigator-desktop button,.reader-secondary-actions button,.reader-mode-actions button,.log-mode-select,.day-toolbar-actions > button,.log-action-export > button,.log-toolbar-more > button')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());previousFits=previousButtons.every(r=>r.left>=bounds.left-0.5&&r.right<=bounds.right+0.5)&&previousButtons.every((r,i)=>previousButtons.slice(i+1).every(other=>r.right<=other.left+0.5||other.right<=r.left+0.5));previousGroups={client:controls.clientWidth,width:controls.getBoundingClientRect().width,gap:getComputedStyle(controls).columnGap,previousButtons:previousButtons.map(r=>({left:r.left,right:r.right,width:r.width})),deleteDisplay:getComputedStyle(controls.querySelector('.log-action-delete')).display,groups:[...controls.children].filter(e=>e.getClientRects().length).map(e=>({className:e.className,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))};controls.dataset.toolbarLayout=layout;}
   return{height:rect.height,available:bounds.width,overlap:identity.right-bounds.left,outside:actions.some(r=>r.x<rect.left-1||r.right>rect.right+1),rowSpread:Math.max(...actions.map(r=>r.y+r.height/2))-Math.min(...actions.map(r=>r.y+r.height/2)),secondaryHidden:getComputedStyle(toolbar.querySelector('.reader-secondary-actions')).display==='none',layout,previousFits,previousGroups:previousFits?previousGroups:null,actions};
  });
  for(const entry of['log','qa-source','qa-link']){
   await fs.writeFile(path.join(root,'progress.json'),JSON.stringify({label,entry,phase:'entry'}));
   await page.setViewportSize({width:1920,height:1000});
   if(entry==='log')await expect(page.locator('.reader-content .markdown-preview').filter({visible:true})).toContainText('合成阅读材料');
   else if(entry==='qa-source'){await page.getByRole('button',{name:'问答',exact:true}).filter({visible:true}).click();const expand=page.getByRole('button',{name:'展开左侧栏',exact:true});if(await expand.isVisible())await expand.click();await page.locator(`.rag-session-item[data-session-id="${sid}"] .rag-session-main`).filter({visible:true}).click();await page.locator('.rag-citation').filter({visible:true}).click();await page.getByRole('button',{name:'查看原日志',exact:true}).click();}
   else{await mode('preview');await page.locator('.reader-content [data-internal-link]').filter({hasText:'前一天'}).click();}
   await expect(toolbar.locator('.reader-navigator-desktop .day-nav-button')).toHaveCount({log:2,'qa-source':3,'qa-link':4}[entry]);await settled();
   if(process.env.LOG_TOOLBAR_ENTRIES&&!process.env.LOG_TOOLBAR_ENTRIES.split(',').includes(entry))continue;
   for(const left of[false,true])for(const right of[false,true]){
    if(process.env.LOG_TOOLBAR_SIDES&&process.env.LOG_TOOLBAR_SIDES!==`${Number(left)}${Number(right)}`)continue;
    await page.setViewportSize({width:1920,height:1000});for(const[side,collapsed]of[['左',left],['右',right]]){const toggle=page.getByRole('button',{name:`${collapsed?'折叠':'展开'}${side}侧栏`,exact:true});if(await toggle.isVisible())await toggle.click();await expect(page.getByRole('button',{name:`${collapsed?'展开':'折叠'}${side}侧栏`,exact:true})).toBeVisible();}
    for(const width of[1920,1600,1440,1280,1180,1100,1024]){if(process.env.LOG_TOOLBAR_WIDTH&&Number(process.env.LOG_TOOLBAR_WIDTH)!==width)continue;await page.setViewportSize({width,height:1000});for(const value of['preview','source','split']){await fs.writeFile(path.join(root,'progress.json'),JSON.stringify({label,entry,left,right,width,mode:value}));await mode(value);const geometry=await inspect(),sample={label,entry,left,right,width,mode:value,...geometry};report.layouts.push(sample);assert.ok(!geometry.outside&&geometry.height<90&&geometry.overlap<=1&&geometry.rowSpread<4,JSON.stringify(sample));assert.ok(geometry.actions.every(a=>a.hit),'Visible controls must be reachable: '+JSON.stringify(sample));if(value!=='preview'&&geometry.secondaryHidden)assert.ok(geometry.actions.filter(a=>a.name!=='工作区模式'&&a.text).every(a=>a.font===0),'Text must compact before editor controls overflow: '+JSON.stringify(sample));assert.notEqual(geometry.previousFits,true,'The previous less compact stage must really overflow: '+JSON.stringify(sample));}}
   }
   record(`${label}: ${entry} ${report.layouts.filter(r=>r.label===label&&r.entry===entry).length} layouts, hit targets and necessary compaction`);await page.screenshot({path:path.join(root,label+'-'+entry+'.png')});
  }
  await page.setViewportSize({width:1920,height:1000});
  for(const side of['左','右']){const expand=page.getByRole('button',{name:`展开${side}侧栏`,exact:true});if(await expand.isVisible())await expand.click();await settled();}
  // Exercise the actual resize handler with 0/2/3/4 navigation slots; restore React-owned nodes synchronously.
  await page.setViewportSize({width:1280,height:1000});await mode('source');
  const probes=await toolbar.evaluate(toolbar=>{const nav=toolbar.querySelector('.reader-navigator-desktop .day-navigator'),original=[...nav.childNodes],rows=[];for(const count of[0,2,3,4]){nav.replaceChildren(...Array.from({length:count},(_,i)=>original[i%original.length].cloneNode(true)));dispatchEvent(new Event('resize'));const root=toolbar.querySelector('.reader-log-controls'),r=root.getBoundingClientRect();rows.push({count,layout:root.dataset.toolbarLayout,fit:[...root.children].filter(e=>e.getClientRects().length).every(e=>{const b=e.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1;})});}nav.replaceChildren(...original);dispatchEvent(new Event('resize'));return rows;});report.probes.push({label,probes});assert.ok(probes.every(p=>p.fit));record(label+': resize handler with 0/2/3/4 navigation slots (DOM probe)');
  const editor=page.locator('.source-workspace .cm-content').filter({visible:true}),draft='未保存的工具栏合成草稿';await editor.press('Control+End');await page.keyboard.insertText('\n\n'+draft);await expect(toolbar.getByRole('button',{name:'保存',exact:true})).toBeEnabled();
  for(const width of[1024,1440,2560]){
   await page.setViewportSize({width,height:1000});await settled();const trigger=toolbar.getByRole('button',{name:'更多操作',exact:true});if(width===1024)await expect(trigger).toBeVisible();if(await trigger.isVisible()){await trigger.click();await expect(toolbar.locator('.log-toolbar-popover')).toBeVisible();assert.ok(await toolbar.locator('.log-toolbar-popover').getByRole('button').filter({visible:true}).count()>0);await page.screenshot({path:path.join(root,`${label}-menu-${width}.png`)});}
   for(const name of['内部链接','插入图片','放弃修改','刷新','日志历史版本','删除当前日志','返回问答','返回链接前位置','上一篇','下一篇'])assert.equal(await toolbar.getByRole('button',{name,exact:true}).filter({visible:true}).count(),1,`${label} ${width}: ${name} has exactly one entry`);
   if(await trigger.isVisible()){const before=await page.evaluate(()=>({tag:document.activeElement?.tagName,className:document.activeElement?.className,inMenu:Boolean(document.activeElement?.closest('.log-toolbar-more'))}));await page.keyboard.press('Escape');await expect(toolbar.locator('.log-toolbar-popover')).toHaveCount(0);await expect(trigger).toBeFocused();report.menuFocus.push({label,width,before,closed:true,triggerFocused:true});}if(width===2560){assert.equal(await trigger.isVisible(),false);assert.equal((await inspect()).layout,'');}
   await expect(editor).toContainText(draft);await mode('split');await expect(editor).toContainText(draft);await mode('source');
  }
  assert.ok(report.menuFocus.some(item=>item.label===label&&item.width===1024),'The narrow menu Escape path must actually run');record(label+': complete overflow menu, Escape focus, wide recovery and unsaved draft');assert.deepEqual(errors,[]);await page.close();page=null;await browser.close();browser=null;
 }
 assert.equal(await fs.readFile(sourceFile,'utf8'),source,'No test writes the original synthetic log');report.passed=true;
}catch(error){report.failure=String(error.stack);report.errors.push(String(error));await page?.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();if(server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'server.log'),log);console.log(JSON.stringify({root,passed:report.passed||false,layouts:report.layouts.length,checks:report.checks.length,failure:report.failure?.split('\n')[0]}));}

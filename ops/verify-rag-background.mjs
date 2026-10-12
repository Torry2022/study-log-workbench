// Real workspace and history API; only synthetic delayed SSE is substituted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const repo=path.resolve(import.meta.dirname,'..');
const root=path.join(repo,'.local',`rag-background-${Date.now()}`),data=path.join(root,'data');
await fs.mkdir(data,{recursive:true});await fs.mkdir(path.join(root,'backups'));
const source='## 2026-09-01\n\n### 合成后台测试\n记录不得被问答改写。\n';
await fs.writeFile(path.join(data,'2026-09_学习日志.md'),source,{flag:'wx'});
await fs.writeFile(path.join(data,'.instance.json'),JSON.stringify({schemaVersion:1,id:'b0310000-0000-4000-8000-000000000001'}));
const base='http://127.0.0.1:3382/study-log',pending=new Map(),closed=new Set(),checks=[];
const packet=(event,body)=>`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
const answer=q=>`${q} 的完整后台回答。`;
const mock=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',new URL(base).origin);res.setHeader('Access-Control-Allow-Headers','content-type');
  if(req.method==='OPTIONS'){res.end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),q=body.question;
  assert.ok(q.startsWith('合成后台-'));assert.ok(!pending.has(q));
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-store');
  pending.set(q,{res,body});res.on('close',()=>{if(!res.writableFinished)closed.add(q);});
  res.write(packet('status',{message:'正在处理合成后台材料'}));res.write(packet('delta',{text:`${q} 的流式片段`}));
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const safe=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3382'],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,LOG_ROOT:data,BACKUP_ROOT:path.join(root,'backups'),APP_PASSWORD:'synthetic-background-password',SESSION_SECRET:'synthetic-background-secret-20261012',COOKIE_SECURE:'false'}});
let log='';server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url));const{chromium,webkit,expect}=require('@playwright/test');
const finish=q=>{const item=pending.get(q);assert.ok(item&&!closed.has(q));item.res.write(packet('done',{answer:answer(q),citations:[]}));item.res.end();};
try {
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base)).ok;}catch{}if(ready||server.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}assert.ok(ready,log);
 for(const [engine,launcher]of Object.entries({chromium,webkit})){
  const browser=await launcher.launch();
  try{for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:theme});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const prefix=`合成后台-${engine}-${theme}-`,q=label=>prefix+label;
   await page.route('**/api/capabilities',async route=>{const response=await route.fetch(),json=await response.json();if(response.ok())json.features.rag={supported:true,configured:true};await route.fulfill({response,json});});
   await page.route('**/api/rag/query',route=>route.continue({url:`http://127.0.0.1:${mock.address().port}/sse`}));
   await page.route('**/api/rag/sessions/*/title',async route=>{const response=await page.request.get(route.request().url().replace(/\/title$/,''));await route.fulfill({response});});
   await page.goto(base);await page.getByLabel('访问密码').fill('synthetic-background-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'问答',exact:true}).click();
   const workspace=page.locator('.rag-workspace').filter({visible:true}),input=page.getByRole('textbox',{name:'输入知识库问题',exact:true});
   const row=id=>page.locator(`.rag-session-item[data-session-id="${id}"]`);
   const fresh=async()=>{await page.getByRole('button',{name:'新建问答',exact:true}).filter({visible:true}).first().click();await expect(input).toHaveValue('');};
   const send=async label=>{await input.fill(q(label));await page.getByRole('button',{name:'发送问题',exact:true}).click();await expect.poll(()=>pending.has(q(label))).toBe(true);await expect(workspace).toContainText(`${q(label)} 的流式片段`);return new URL(page.url()).searchParams.get('session');};
   const open=async id=>{await row(id).locator('.rag-session-main').click();await expect(page).toHaveURL(new RegExp(`session=${id}`));};
   const get=async id=>{const response=await page.request.get(`${base}/api/rag/sessions/${id}`);return response.ok()?(await response.json()).session:null;};
   const saved=async(id,label)=>{await expect.poll(async()=> (await get(id))?.messages.at(-1)?.content).toBe(answer(q(label)));};
   const a=await send('A');assert.ok(a);await expect(row(a).getByRole('status',{name:'正在生成',exact:true})).toBeVisible();
   await fresh();const b=await send('B');assert.notEqual(a,b);await expect(row(a).getByRole('status',{name:'正在生成',exact:true})).toBeVisible();
   await open(a);await expect(workspace).toContainText(`${q('A')} 的流式片段`);await expect(workspace).not.toContainText(q('B'));
   await page.getByRole('button',{name:'最近问答',exact:true}).count().then(async count=>{if(!count)await page.getByRole('button',{name:'折叠左侧栏',exact:true}).click();});
   await page.getByRole('button',{name:'最近问答',exact:true}).click();await expect(page.locator('.rag-history-popover').getByRole('status',{name:'正在生成',exact:true})).toHaveCount(2);
   await page.screenshot({path:path.join(root,`${engine}-${theme}-running.png`)});await page.keyboard.press('Escape');await page.getByRole('button',{name:'展开左侧栏',exact:true}).click();
   await page.getByRole('button',{name:'随记',exact:true}).click();assert.ok(!closed.has(q('A'))&&!closed.has(q('B')));
   finish(q('A'));await saved(a,'A');finish(q('B'));await saved(b,'B');await expect(page.getByRole('heading',{name:'随记',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'问答',exact:true}).click();await expect(workspace).toContainText(answer(q('A')));await expect(row(b).getByRole('status',{name:'新回答',exact:true})).toBeVisible();
   await open(b);await expect(workspace).toContainText(answer(q('B')));await expect(workspace).not.toContainText(q('A'));await expect(row(b).getByRole('status')).toHaveCount(0);
   await fresh();const c=await send('C');await fresh();const d=await send('D');await open(c);await page.getByRole('button',{name:'停止生成',exact:true}).click();
   await expect(workspace).toContainText('生成已停止');await expect.poll(()=>closed.has(q('C'))).toBe(true);assert.ok(!closed.has(q('D')));assert.equal(await get(c),null);
   finish(q('D'));await saved(d,'D');await expect(workspace).not.toContainText(answer(q('D')));
   await fresh();const e=await send('E');let fail=true;const writes=[];
   await page.route('**/api/rag/sessions',async route=>{if(route.request().method()!=='POST'||route.request().postDataJSON().id!==e)return route.continue();writes.push(route.request().postDataJSON());if(fail){fail=false;return route.fulfill({status:500,json:{error:'合成后台保存失败'}});}await route.continue();});
   await open(b);finish(q('E'));await expect(row(e).getByRole('status',{name:'未保存',exact:true})).toBeVisible();await expect(workspace).toContainText(answer(q('B')));
   await open(e);await expect(workspace).toContainText(answer(q('E')));await page.getByRole('button',{name:'重试保存',exact:true}).click();await saved(e,'E');assert.deepEqual(writes[0],writes[1]);
   await open(b);let renameFail=true;const renameWrites=[];await page.route(`**/api/rag/sessions/${a}`,async route=>{if(route.request().method()!=='PATCH')return route.continue();renameWrites.push(route.request().postDataJSON());if(renameFail){renameFail=false;return route.fulfill({status:500,json:{error:'合成后台重命名失败'}});}await route.continue();});
   await row(a).locator('.rag-session-menu-button').click();await row(a).getByRole('button',{name:'重命名',exact:true}).click();const rename=page.getByRole('textbox',{name:'会话标题',exact:true});await rename.fill(q('A改名'));await rename.press('Enter');await expect(page.locator('.editor-navigation-status[role=alert]').filter({visible:true})).toContainText('合成后台重命名失败');await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(page).toHaveURL(new RegExp(`session=${b}`));await expect(workspace).toContainText(answer(q('B')));await expect(page.locator('.editor-navigation-status[role=alert]').filter({visible:true})).toHaveCount(0);await rename.press('Enter');await expect(rename).toHaveCount(0);assert.deepEqual(renameWrites[0],renameWrites[1]);
   await page.unroute(`**/api/rag/sessions/${a}`);let releaseRead,readStarted;const readGate=new Promise(resolve=>{releaseRead=resolve;}),readStart=new Promise(resolve=>{readStarted=resolve;});await page.route(`**/api/rag/sessions/${a}`,async route=>{if(route.request().method()!=='GET')return route.continue();readStarted();await readGate;try{const response=await route.fetch();await route.fulfill({response});}catch{}});
   await row(a).locator('.rag-session-main').click();await readStart;await open(b);await expect(input).toBeEnabled();await expect(workspace).toContainText(answer(q('B')));releaseRead();await page.unroute(`**/api/rag/sessions/${a}`,{behavior:'wait'});
   await page.unroute('**/api/rag/sessions');await fresh();const savingId=await send('保存中登录');let releaseSave,saveStarted;const saveGate=new Promise(resolve=>{releaseSave=resolve;}),saveStart=new Promise(resolve=>{saveStarted=resolve;}),authWrites=[];
   await page.route('**/api/rag/sessions',async route=>{if(route.request().method()!=='POST'||route.request().postDataJSON().id!==savingId)return route.continue();authWrites.push(route.request().postDataJSON());if(authWrites.length===1){saveStarted();await saveGate;}const response=await route.fetch();await route.fulfill({response});});
   finish(q('保存中登录'));await saveStart;await expect(row(savingId).getByRole('status',{name:'正在保存',exact:true})).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('study-log:auth-expired')));await page.getByLabel('访问密码').fill('synthetic-background-password');await page.getByRole('button',{name:'登录',exact:true}).click();releaseSave();await expect(page.getByRole('button',{name:'重试保存',exact:true})).toBeVisible();await page.getByRole('button',{name:'重试保存',exact:true}).click();await saved(savingId,'保存中登录');await expect(page.getByRole('button',{name:'重试保存',exact:true})).toHaveCount(0);assert.deepEqual(authWrites[0],authWrites[1]);await page.unroute('**/api/rag/sessions');
   await fresh();await input.fill(q('草稿'));await page.getByRole('button',{name:'日志',exact:true}).filter({visible:true}).first().click();await page.getByRole('button',{name:'问答',exact:true}).click();
   await page.locator('.rag-session-main').filter({hasText:q('草稿')}).click();await expect(input).toHaveValue(q('草稿'));await open(b);await expect(input).toHaveValue('');
   await page.evaluate(()=>window.dispatchEvent(new Event('study-log:auth-expired')));await page.getByLabel('访问密码').fill('synthetic-background-password');await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.locator('.rag-session-main').filter({hasText:q('草稿')}).click();await expect(input).toHaveValue(q('草稿'));await input.fill('');
   await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开问答历史',exact:true}).click();await row(b).locator('.rag-session-main').click();await expect(page.locator('.sidebar.mobile-open')).toHaveCount(0);await expect(workspace).toContainText(answer(q('B')));
   await send('手机续问');await page.getByRole('button',{name:'打开问答历史',exact:true}).click();await expect.poll(()=>page.locator('.sidebar.mobile-open').evaluate(element=>Math.abs(element.getBoundingClientRect().left))).toBeLessThan(1);await expect(row(b).getByRole('status',{name:'正在生成',exact:true})).toBeVisible();await page.screenshot({path:path.join(root,`${engine}-${theme}-mobile-running.png`)});await row(b).locator('.rag-session-main').click();
   await page.getByRole('button',{name:'随记',exact:true}).click();finish(q('手机续问'));await saved(b,'手机续问');await page.getByRole('button',{name:'问答',exact:true}).click();await expect(workspace).toContainText(answer(q('手机续问')));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(root,`${engine}-${theme}-mobile.png`)});
   await page.setViewportSize({width:1440,height:900});await send('退出取消');await page.getByRole('button',{name:'随记',exact:true}).click();await page.getByRole('button',{name:'退出',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();assert.ok(!closed.has(q('退出取消')));finish(q('退出取消'));await saved(b,'退出取消');
   await page.getByRole('button',{name:'退出',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'放弃并退出',exact:true}).click();await page.getByLabel('访问密码').fill('synthetic-background-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'问答',exact:true}).click();await expect(row(c)).toHaveCount(0);
   assert.deepEqual(errors,[]);checks.push({engine,theme,concurrent:true,moduleSwitch:true,independentStop:true,saveRetry:true,authDuringSave:true,draftAuth:true,mobile:true,exitCancel:true,discardExit:true});await page.close();
  }}finally{await browser.close();}
 }
 assert.equal(await fs.readFile(path.join(data,'2026-09_学习日志.md'),'utf8'),source);await fs.writeFile(path.join(root,'results.json'),JSON.stringify({checks,sourceUnchanged:true,paidModelCalls:0},null,2));console.log(JSON.stringify({root,checks}));
}finally{
 server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await fs.writeFile(path.join(root,'server.log'),log);
}

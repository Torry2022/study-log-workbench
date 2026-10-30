// Production UI, HTTP and SQLite; all model/MCP traffic uses loopback synthetic fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const appRoot=process.env.QA_JUMP_APP; assert.ok(appRoot,'QA_JUMP_APP required');
const require=createRequire(path.join(appRoot,'package.json'));
const {chromium,webkit,expect}=require('@playwright/test');
const engine=process.env.QA_JUMP_ENGINE||'chromium';assert.ok(['chromium','webkit'].includes(engine));
const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'study-log-qa-jump-'));
const output=process.env.QA_JUMP_OUTPUT||path.join(fixture,'evidence');await fs.mkdir(output,{recursive:true});
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const contexts=Array.from({length:6},(_,i)=>({sourceId:`S${i+1}`,date:'2026-10-01',month:'2026-10',fileName:'2026-10_学习日志.md',heading:`合成检索记录${i+1}`,headingIndex:i,chunkId:`2026-10-01:${i}`,contentHash:'a'.repeat(64),content:`合成检索记录${i+1}：检索结果需回到原文核对。`,excerpt:`合成来源${i+1}`,score:1,truncated:false}));
const pending=[],eventTransports=new Set();
let app,browser,currentPage,appOutput='',modelCalls=0;
const prompts=[];
const service=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/task-events?')){
   const target=new URL(req.url,'http://127.0.0.1').searchParams.get('target');assert.equal(new URL(target).hostname,'127.0.0.1');
   const controller=new AbortController();res.on('close',()=>{eventTransports.delete(res);controller.abort()});
   const upstream=await fetch(target,{headers:{cookie:req.headers.cookie||''},signal:controller.signal});
   res.writeHead(upstream.status,{'content-type':'text/event-stream','access-control-allow-origin':req.headers.origin,'access-control-allow-credentials':'true'});res.flushHeaders();eventTransports.add(res);
   try{for await(const chunk of upstream.body)res.write(chunk);}catch(error){if(!controller.signal.aborted)throw error;}res.end();return;
  }
  if(req.url==='/mcp'){
   if(req.method!=='POST'){res.writeHead(405);res.end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const rpc=JSON.parse(Buffer.concat(chunks));
   if(rpc.id===undefined){res.writeHead(202);res.end();return;}
   const evidence={contexts,context:{maxChunks:8,maxChars:12000,returnedChunks:6,totalChars:contexts.reduce((n,x)=>n+x.content.length,0),truncated:false}};
   const result=rpc.method==='initialize'?{protocolVersion:rpc.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'jump-fixture',version:'1'}}:rpc.method==='tools/list'?{tools:[]}:rpc.method==='ping'?{}:{content:[{type:'text',text:JSON.stringify(evidence)}]};
   res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}));return;
  }
  if(req.url==='/models'&&req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model',context_window:32768,max_output_tokens:4096}]}));return}
  assert.equal(req.url,'/chat/completions');const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));
  if(!body.stream){
   const system=body.messages[0]?.content||'';
   let content='合成检索回顾';
   if(system.includes('生成检索计划'))content=JSON.stringify({strategy:'relevance',dateFrom:null,dateTo:null,useWiki:false});
   if(system.includes('理解追问')){const request=JSON.parse(body.messages.at(-1).content);content=JSON.stringify({query:request.question,scopeSource:null,strategy:'relevance',useWiki:false});}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));return
  }
  modelCalls++;
  const lastUser=body.messages.findLastIndex(m=>m.role==='user'),lastTool=body.messages.findLastIndex(m=>m.role==='tool');
  const messageText=m=>typeof m.content==='string'?m.content:m.content.filter(part=>part.type==='text').map(part=>part.text).join('');
  const canonical=body.messages.filter(m=>m.role==='user').map(messageText).findLast(text=>text.startsWith('当前问题：'));
  // Legacy and Pi use their actual input envelopes.
  const currentQuestion=canonical || messageText(body.messages[lastUser]);
  const prompt=currentQuestion.split('查阅工作笔记（')[0].split('本轮知识库证据：')[0].split('用于本轮检索的独立问题（')[0].replace(/^当前问题：/,'').trim();
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,reason=null)=>res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
  if(body.tools?.length && lastTool<lastUser && body.tool_choice!=='none'){prompts.push(prompt);send({role:'assistant',tool_calls:[{index:0,id:`tool-${modelCalls}`,type:'function',function:{name:'search_records',arguments:JSON.stringify({query:'合成检索',gap:'缺少合成记录的依据'})}}]});send({},'tool_calls');}
  else{
   send({role:'assistant',content:'已查阅合成记录。'});
   await new Promise(resolve=>pending.push({send,finish:()=>{if(res.writableEnded)return;send({content:'\n\n合成回答结束。[S1]'});send({},'stop');resolve();}}));
  }
  res.end('data: [DONE]\n\n');
 }catch(error){res.end(String(error))}
});
const checks=[],details={};
const until=async(read,test,timeout=20000)=>{const start=Date.now();for(;;){const value=await read();if(test(value))return value;if(Date.now()-start>timeout)throw Error('Timed out: '+JSON.stringify(value));await delay(50)}};
try{
 const servicePort=await listen(service),reserve=http.createServer(),port=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));
 await fs.writeFile(path.join(fixture,'2026-10_学习日志.md'),'## 2026-10-01\n\n'+contexts.map((c,i)=>`### ${i+1}. ${c.heading}\n\n${c.content}`).join('\n\n'));
 await fs.mkdir(path.join(fixture,'.backups'));
 await fs.writeFile(path.join(fixture,'.instance.json'),JSON.stringify({schemaVersion:1,id:'7d5a238c-a843-4d55-8ea8-c829f39c3108'}));
 const base=`http://127.0.0.1:${port}/study-log`;
 const safe=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:appRoot,windowsHide:true,env:{...safe,LOG_ROOT:fixture,BACKUP_ROOT:path.join(fixture,'.backups'),RAG_RUNTIME:process.env.QA_JUMP_RUNTIME||'pi',APP_PASSWORD:'synthetic-ui-password',SESSION_SECRET:'synthetic-ui-session-secret-local-only',COOKIE_SECURE:'false',CHAT_API_KEY:'synthetic-model-key',CHAT_MODEL:'fixture-model',CHAT_API_URL:`http://127.0.0.1:${servicePort}/chat/completions`,DEEPSEEK_API_KEY:'synthetic-model-key',DEEPSEEK_MODEL:'fixture-model',DEEPSEEK_FLASH_MODEL:'fixture-model',DEEPSEEK_BASE_URL:`http://127.0.0.1:${servicePort}/chat/completions`,STUDY_LOG_MCP_URL:`http://127.0.0.1:${servicePort}/mcp`,STUDY_LOG_MCP_TOKEN:'synthetic-mcp-token',RAG_JEV_ENABLED:'false',RAG_STATUS_VERIFICATION_ENABLED:'false'}});
 app.stdout.on('data',c=>appOutput+=c);app.stderr.on('data',c=>appOutput+=c);
 await until(()=>fetch(base).then(r=>r.status<500).catch(()=>false),Boolean);
 browser=await ({chromium,webkit})[engine].launch();const context=await browser.newContext({viewport:{width:1440,height:900}});
 await context.addInitScript(port=>{const Native=window.EventSource;window.EventSource=class extends Native{constructor(url,options){const original=new URL(url,location.href);super(original.pathname.endsWith('/events')?`http://127.0.0.1:${port}/task-events?target=${encodeURIComponent(original.href)}`:url,{...options,withCredentials:true});}};},servicePort);
 const page=await context.newPage();currentPage=page;
 const inflight=new Set();page.on('request',r=>{if(r.url().includes('/api/rag/')&&!r.url().includes('/events'))inflight.add(r)});for(const event of ['requestfinished','requestfailed'])page.on(event,r=>inflight.delete(r));const requests=[],eventUrls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/rag/'))requests.push({method:r.method(),url:r.url(),body:r.postData()});if(r.url().includes('/task-events?'))eventUrls.push(r.url());});
 assert.equal((await context.request.post(`${base}/api/auth/login`,{data:{password:'synthetic-ui-password'}})).status(),200);
 for(const width of [1440,390]){
  const failureContext=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
  await failureContext.request.post(`${base}/api/auth/login`,{data:{password:'synthetic-ui-password'}});
  const failurePage=await failureContext.newPage();const missing=crypto.randomUUID();
  await failurePage.goto(`${base}?view=qa&session=${missing}`);
  const strip=failurePage.locator('.rag-navigation-error').first();await expect(strip).toContainText('问答会话不存在');
  await failurePage.evaluate(()=>document.fonts.ready);
  const bar=await strip.boundingBox(),heading=await failurePage.locator('.reader-toolbar-qa').boundingBox(),reader=await failurePage.locator('.reader').boundingBox();
  assert.ok(Math.abs(bar.y-heading.y-heading.height)<2,'error strip meets the header border');
  assert.ok(Math.abs(bar.x-reader.x)<2&&Math.abs(bar.width-reader.width)<2,'error strip spans the reader width');
  assert.ok(bar.height<=40,'short errors use a compact strip');
  assert.equal(await failurePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await expect(failurePage.locator('.rag-empty')).toHaveCount(0);
  await failurePage.screenshot({path:path.join(output,`${engine}-${width}-history-error.png`)});
  await failurePage.screenshot({path:path.join(output,`${engine}-${width}-history-error-strip.png`),clip:{x:reader.x,y:heading.y,width:Math.min(reader.width,width-reader.x),height:heading.height+bar.height+12}});
  await strip.getByRole('button',{name:'关闭',exact:true}).click();await expect(strip).toHaveCount(0);await expect(failurePage.locator('.rag-empty')).toBeVisible();
  await failureContext.close();
 }
 await page.goto(base+'?view=qa');const input=page.getByRole('textbox',{name:'输入知识库问题'});await expect(input).toBeEnabled();
 const tasks=async()=>(await(await context.request.get(`${base}/api/rag/tasks`)).json()).tasks;
 const task=async id=>(await(await context.request.get(`${base}/api/rag/tasks/${id}`)).json()).task;
 const send=async text=>{const before=pending.length;await input.fill(text);await page.getByRole('button',{name:'发送问题',exact:true}).click();await until(()=>pending.length,n=>n===before+1);return pending.at(-1)};
 const first=await send('核对长回答的回到底部操作');
 first.send({content:'\n\n'+Array.from({length:55},(_,i)=>`第${i+1}段：${'回到底部保留阅读位置与后续跟随。'.repeat(6)}`).join('\n\n')});
 await expect(page.locator('.rag-answer').last()).toContainText('第55段',{timeout:30000});const anchor=(await tasks()).find(t=>t.state==='running');assert.ok(anchor);const screenshots=[];
 for(const [width,height,touch] of [[1440,900,false],[820,1000,true],[390,844,true]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});await ctx.request.post(`${base}/api/auth/login`,{data:{password:'synthetic-ui-password'}});const view=await ctx.newPage();view.on('pageerror',e=>errors.push(e.message));await view.goto(`${base}?view=qa&session=${anchor.sessionId}`);await expect(view.locator('.rag-answer').last()).toContainText('第55段',{timeout:30000});await view.evaluate(()=>document.fonts.ready);
  await view.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await view.waitForTimeout(200);await expect(view.getByRole('button',{name:'回到底部',exact:true})).toHaveCount(0);
  await view.mouse.move(width/2,height/2);if(touch) await view.evaluate(()=>scrollBy(0,-550)); else await view.mouse.wheel(0,-550);await view.waitForTimeout(200);const bottom=view.getByRole('button',{name:'回到底部',exact:true});await expect(bottom).toBeVisible();
  const bounds=await bottom.boundingBox(),dock=await view.locator('.rag-composer-slot').boundingBox();const hidden=await view.locator('.rag-composer-slot').evaluate(n=>n.classList.contains('is-hidden'));assert.ok(bounds.y>=0&&bounds.y+bounds.height<=(hidden?height:dock.y+1));assert.ok(Math.abs(bounds.x+bounds.width/2-dock.x-dock.width/2)<2);assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const hover=await view.evaluate(()=>matchMedia('(hover: hover) and (pointer: fine)').matches);
  if(hover){await expect(bottom.locator('.rag-scroll-busy')).toBeVisible();const busyShot=path.join(output,`${engine}-${width}-generating.png`);await view.screenshot({path:busyShot});screenshots.push(busyShot);await expect(bottom.locator('.rag-scroll-arrow')).not.toBeVisible();await bottom.hover();await expect(bottom.locator('.rag-scroll-arrow')).toBeVisible();await expect(bottom.locator('.rag-scroll-busy')).not.toBeVisible();await view.mouse.move(0,0);await bottom.focus();await bottom.press('ArrowRight');await expect(bottom.locator('.rag-scroll-arrow')).toBeVisible();}
  else{await expect(bottom.locator('.rag-scroll-arrow')).toBeVisible();await expect(bottom.locator('.rag-scroll-busy')).not.toBeVisible();}
  const screenshot=path.join(output,`${engine}-${width}-away.png`);await view.screenshot({path:screenshot});screenshots.push(screenshot);
  const draft=view.getByRole('textbox',{name:'输入知识库问题'});const editable=await draft.isEnabled();if(editable)await draft.focus();await view.evaluate(()=>{window.qaReturnSamples=[];window.qaReturnProbe=()=>window.qaReturnSamples.push(scrollY);addEventListener('scroll',window.qaReturnProbe)});await bottom.click();await expect(bottom).toHaveCount(0);assert.ok(await view.evaluate(()=>new Set(window.qaReturnSamples.map(Math.round)).size)>=4,'explicit return visibly traverses intermediate positions');await view.evaluate(()=>removeEventListener('scroll',window.qaReturnProbe));if(editable)assert.equal(await draft.evaluate(n=>document.activeElement===n),true,'jump preserves the current input focus');
  const marker=`恢复跟随${width}`;first.send({content:'\n\n'+marker+'新的正文。'.repeat(100)});await expect(view.locator('.rag-answer').last()).toContainText(marker);await view.waitForTimeout(300);assert.ok(await view.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY)<4,'explicit jump resumes live follow');view.removeAllListeners('pageerror');await ctx.close();
 }
 first.finish();await until(()=>task(anchor.id),t=>t.saveState==='saved');
 await page.addInitScript(()=>{
  window.qaHydrationProbe={saving:false,firstQuestionHasTime:null};
  new MutationObserver(()=>{
   if(document.querySelector('.rag-save-state')?.textContent.includes('保存中')||document.querySelector('.rag-session-status.saving')) window.qaHydrationProbe.saving=true;
   const question=document.querySelector('.rag-message-user');
   if(question&&window.qaHydrationProbe.firstQuestionHasTime===null) window.qaHydrationProbe.firstQuestionHasTime=Boolean(question.previousElementSibling?.querySelector('time'));
  }).observe(document,{childList:true,subtree:true,characterData:true});
 });
 const timeList=`**/api/rag/tasks?sessionId=${anchor.sessionId}`;
 await page.route(timeList,async route=>{await delay(700);await route.continue();});
 await until(()=>inflight.size,n=>n===0);await page.reload();await expect(page.locator('.rag-answer')).toContainText('第55段');await page.waitForTimeout(1200);
 const hydration=await page.evaluate(()=>window.qaHydrationProbe);
 assert.equal(hydration.saving,false,'reading saved history never advertises a write');
 assert.equal(hydration.firstQuestionHasTime,true,'time divider and history appear in the same render, even with delayed task metadata');
 await page.unroute(timeList);
 const timeBox=await page.locator('.rag-time-divider, .rag-time-separator').first().boundingBox();
 const bubbleBox=await page.locator('.rag-message-user p').first().boundingBox();
 assert.ok(Math.abs(bubbleBox.y-timeBox.y-timeBox.height-8)<2,'only 8px between time row and user bubble');
 assert.equal(await page.locator('.rag-time-divider time, .rag-time-separator time').first().evaluate(n=>getComputedStyle(n).fontSize),'13px');
 await page.screenshot({path:path.join(output,`${engine}-history-loaded.png`)});
 await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(150);
 await page.mouse.move(700,400);await page.mouse.wheel(0,-500);
 await expect(page.locator('.rag-composer-slot')).toHaveClass(/is-hidden/);
 const hiddenBottom=page.getByRole('button',{name:'回到底部',exact:true});await expect(hiddenBottom).toBeVisible();
 const hiddenBounds=await hiddenBottom.boundingBox();assert.ok(hiddenBounds.y+hiddenBounds.height>820&&hiddenBounds.y+hiddenBounds.height<900,'hidden composer leaves the bottom control near the viewport edge');
 await page.waitForTimeout(180); await page.screenshot({path:path.join(output,`${engine}-composer-hidden.png`)});
 await expect(page.locator('.rag-scroll-busy')).not.toBeVisible();await hiddenBottom.click();
 await expect(page.locator('.rag-composer-slot')).not.toHaveClass(/is-hidden/);
 await until(()=>page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY),value=>value<4);

 await input.fill('从阅读位置发起新问题');await page.mouse.move(700,400);await page.mouse.wheel(0,-650);await expect(page.getByRole('button',{name:'回到底部',exact:true})).toBeVisible();
 const beforeNext=pending.length;await page.getByRole('button',{name:'发送问题',exact:true}).click();await until(()=>pending.length,n=>n===beforeNext+1);await page.waitForTimeout(350);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY)<4,'sending a new question from history restores bottom follow');
 await until(async()=>{for(const stream of pending)stream.finish();return tasks();},rows=>rows.every(t=>t.saveState==='saved'));
 const beforeRegenerate=pending.length;
 await page.getByRole('button',{name:'重新生成',exact:true}).last().click();await until(()=>pending.length,n=>n===beforeRegenerate+1);
 const interrupted=(await tasks()).find(t=>t.sessionId===anchor.sessionId&&t.state==='running');assert.ok(interrupted);
 assert.equal((await context.request.post(`${base}/api/rag/tasks/${interrupted.id}/cancel`)).status(),200);pending.at(-1).finish();
 await until(()=>task(interrupted.id),t=>t.state==='cancelled');
 await page.route(timeList,async route=>{await delay(700);await route.continue();});
 await until(()=>inflight.size,n=>n===0);await page.reload();await expect(page.locator('.rag-answer').first()).toContainText('第55段');await page.waitForTimeout(1200);
 assert.equal((await page.evaluate(()=>window.qaHydrationProbe)).firstQuestionHasTime,true,'a retained stopped version cannot paint history ahead of its time metadata');
 await page.unroute(timeList);
 await page.getByRole('button',{name:'新建问答',exact:true}).filter({visible:true}).first().click();await expect(page.locator('.rag-message')).toHaveCount(0);await expect(page.getByRole('button',{name:'回到底部',exact:true})).toHaveCount(0);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,engine,appRoot,modelCalls,checks:['full-width compact history error strip','failed history is distinct from a new empty conversation','bottom and empty hide','centered above entire composer','pointer-aware loading hover and keyboard','touch retains arrow','click preserves input focus and resumes streaming follow','completed answer and navigation','saved history has no write indicator','time metadata hydrates atomically','stopped-version history hydrates atomically','hidden composer moves bottom control to viewport edge'],screenshots},null,2));console.log(JSON.stringify({passed:true,engine,modelCalls}));
}catch(error){console.error(appOutput);if(currentPage)await currentPage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{for(const p of pending)p.finish();await browser?.close();if(app&&app.exitCode===null){app.kill();await once(app,'exit')}service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}

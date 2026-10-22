import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {initialize} from './instance.mjs';
import {startHttpServer} from '../study-log-mcp/src/http-server.mjs';
import {StudyLogStore} from '../study-log-mcp/src/log-store.mjs';
import {KeywordRetriever} from '../study-log-mcp/src/retrieval.mjs';
import {RagTaskStore} from '../study-log-web/lib/rag-task-store.ts';
import {createRagSession,applyRagTaskResult,renameRagSession,getRagSession} from '../study-log-web/lib/rag-sessions-store.ts';

// Real session storage, task entrypoint, MCP and production UI; only the model is a local substitute.
const repo=path.resolve(import.meta.dirname,'..'),root=path.join(repo,'.local',`rag-answer-continuation-${Date.now()}`);
const instance=path.join(root,'instance'),data=path.join(instance,'data');
await fs.mkdir(root,{recursive:true});await initialize(instance);
const environment=parseEnv(await fs.readFile(path.join(instance,'.env'),'utf8'));
process.env.LOG_ROOT=data;process.env.BACKUP_ROOT=path.join(instance,'backups');
process.env.RERANK_ENABLED='false';process.env.DASHSCOPE_API_KEY='';
process.env.STUDY_LOG_INDEX_ROOT=path.join(instance,'index');
const source='## 2026-09-01\n\n### 合成保存\n\n合成保存先确认内容。\n\n---\n\n## 2026-09-02\n\n### 合成保存\n\n合成保存后核对记录。\n';
const sourceFile=path.join(data,'2026-09_学习日志.md');await fs.writeFile(sourceFile,source);
const report={root,checks:[],requests:[],modelRequests:[],errors:[],paidModelCalls:0};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,accept,timeout=20000){const start=Date.now();for(;;){const value=await read();if(accept(value))return value;if(Date.now()-start>timeout)throw Error(`Timed out: ${JSON.stringify(value)}`);await pause(40);}}
const evidence=await new StudyLogStore(data,{indexRoot:path.join(instance,'index'),retriever:new KeywordRetriever()}).retrieveContexts('合成保存',{maxChunks:4,maxChars:20000});
const citation=date=>{const context=evidence.contexts.find(item=>item.date===date);assert.ok(context);const {month,heading,headingIndex,fileName,chunkId,contentHash,excerpt}=context;return {sourceId:'S1',date,month,heading,headingIndex,fileName,chunkId,contentHash,excerpt};};
const cases=['success','failure','uncertain','conflict','switch','draft-change','reload-preview'];
const labels=['chromium-desktop','chromium-phone','webkit-desktop','webkit-phone'];
const fixtures=new Map(),store=new RagTaskStore(data),seedOwner=`${process.pid}:continuation-fixtures`;
assert.equal(store.leader(seedOwner),true);
for(const label of labels)for(const name of [...cases,'destination']){
 assert.equal(store.leader(seedOwner),true);
 const id=randomUUID(),questionId=randomUUID(),old={id:randomUUID(),role:'assistant',content:`合成旧回答 ${label} ${name}：先确认内容。`,status:'complete',citations:[citation('2026-09-01')]};
 let saved=await createRagSession({id,mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:questionId,role:'user',content:'合成保存如何进行？',status:'complete'},old]});
 const task=store.create({submissionId:randomUUID(),sessionId:id,baseVersion:saved.version,question:'合成保存如何进行？',mode:'logs_only',replaceLast:true,history:[]},[],{questionMessageId:questionId,previousAnswer:old});
 const claimed=store.claim(seedOwner);assert.equal(claimed.id,task.id);
 const result={answer:`合成新回答 ${label} ${name}：保存后核对记录。`,citations:[citation('2026-09-02')]};
 store.finish(claimed,'succeeded',result);saved=await applyRagTaskResult({taskId:task.id,sessionId:id,baseVersion:saved.version,question:task.question,answerMode:'logs_only',replaceLast:true,...result});store.saved(task.id,'saved');
 saved=await renameRagSession(id,{mutationId:randomUUID(),baseVersion:saved.version,title:`合成 ${label} ${name}`});
 fixtures.set(`${label}:${name}`,{id,old,saved});
}
store.shutdown(seedOwner); // The real Web worker, not this test fixture, owns all new tasks.
let streams=0,holdStream=false,holdTitles=false,web,browser,page,serverLog='';
const heldTitles=[];
const pending=new Map();
const finish=n=>{const response=pending.get(n);assert.ok(response,`Pending model ${n}`);response.end(`data: ${JSON.stringify({choices:[{delta:{content:'，并核对记录。[S1]'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:12}})}\n\ndata: [DONE]\n\n`);pending.delete(n);};
const model=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
 report.modelRequests.push(input);
 res.setHeader('content-type',input.stream?'text/event-stream':'application/json');
 if(!input.stream){const title=input.messages?.[0]?.content?.includes('短语式标题');const respond=()=>res.end(JSON.stringify({choices:[{message:{content:title?'合成保存问答':JSON.stringify({query:'合成保存',scopeSource:null,strategy:'relevance'})},finish_reason:'stop'}],usage:{prompt_tokens:8,completion_tokens:4}}));if(title&&holdTitles)heldTitles.push(respond);else respond();return;}
 const n=++streams;pending.set(n,res);res.write(`data: ${JSON.stringify({choices:[{delta:{content:`合成续问回答${n}`},finish_reason:null}]})}\n\n`);
 if(!holdStream)finish(n);
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const mcp=await startHttpServer({host:'127.0.0.1',port:0,logRoot:data,indexRoot:path.join(instance,'index'),token:'synthetic-continuation-mcp',retrieval:{embedding:{apiKey:'',apiUrl:'',model:''},reranker:{apiKey:'',apiUrl:'',model:''},rerankEnabled:false}});
const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}/study-log`,{chromium,webkit,expect}=createRequire(new URL('../study-log-web/package.json',import.meta.url))('@playwright/test');
const safe=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
try{
 web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,...environment,NODE_ENV:'production',LOG_ROOT:data,BACKUP_ROOT:process.env.BACKUP_ROOT,CHAT_API_URL:`http://127.0.0.1:${model.address().port}/chat`,CHAT_API_KEY:'synthetic-model-key',CHAT_MODEL:'synthetic-model',CHAT_LIGHT_MODEL:'synthetic-model',STUDY_LOG_MCP_URL:`http://127.0.0.1:${mcp.address.port}/mcp`,STUDY_LOG_MCP_TOKEN:'synthetic-continuation-mcp',RAG_AGENT_ENABLED:'false',RAG_AGENT_TOOL_CALLING_VERIFIED:'false',RAG_JEV_ENABLED:'false',RAG_STATUS_VERIFICATION_ENABLED:'false'}});
 web.stdout.on('data',chunk=>serverLog+=chunk);web.stderr.on('data',chunk=>serverLog+=chunk);
 await until(()=>fetch(base).then(r=>r.ok).catch(()=>false),Boolean,30000);
 for(const label of labels){
  if(process.env.RAG_CONTINUATION_ONLY&&process.env.RAG_CONTINUATION_ONLY!==label)continue;
  const mobile=label.endsWith('phone'),launcher=label.startsWith('webkit')?webkit:chromium,theme=mobile?'dark':'light';
  browser=await launcher.launch();const context=await browser.newContext({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile,colorScheme:theme});page=await context.newPage();
  await page.addInitScript(theme=>localStorage.setItem('study-log-theme',theme),theme);
  page.on('pageerror',error=>report.errors.push({label,url:page.url(),message:error.message,stack:error.stack}));
  const posts=[];page.on('request',request=>{if(request.url().includes('/api/rag/')){report.requests.push({method:request.method(),path:new URL(request.url()).pathname});if(request.method()==='POST'&&request.url().endsWith('/api/rag/tasks'))posts.push(request.postDataJSON());}});
  await page.goto(base);await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.workspace')).toBeVisible();await page.waitForLoadState('networkidle');
  const composer=()=>page.getByRole('textbox',{name:'输入知识库问题'}),send=()=>page.getByRole('button',{name:'发送问题',exact:true});
  const switchTo=async id=>{if(mobile)await page.getByRole('button',{name:'打开问答历史',exact:true}).click();await page.locator(`.rag-session-item[data-session-id="${id}"] .rag-session-main`).filter({visible:true}).click();await expect(page).toHaveURL(new RegExp(`session=${id}`));};
  await page.getByRole('button',{name:'问答',exact:true}).filter({visible:true}).click();await expect(page.locator('.rag-workspace:visible')).toBeVisible();
  for(const name of cases){
   if(process.env.RAG_CONTINUATION_CASE&&process.env.RAG_CONTINUATION_CASE!==name)continue;
   const fixture=fixtures.get(`${label}:${name}`),url=`${base}/api/rag/sessions/${fixture.id}`;
   await switchTo(fixture.id);
   const answer=page.locator('.rag-workspace:visible .rag-message-assistant').last();
   await expect(answer).toContainText('合成新回答');await expect(send()).toBeDisabled();
   if(name==='reload-preview'){
    const baselinePosts=posts.length,baselineStreams=streams;await page.waitForLoadState('networkidle');
    await answer.getByRole('button',{name:'上一个回答版本',exact:true}).click();await expect(answer).toContainText(fixture.old.content);await composer().fill('重新读取失败时保留的草稿');
    const taskUrl=`${base}/api/rag/tasks?sessionId=${fixture.id}`,failedTask=route=>route.fulfill({status:500,json:{error:'合成版本列表读取失败'}});
    await page.route(taskUrl,failedTask);await switchTo(fixtures.get(`${label}:destination`).id);await switchTo(fixture.id);await expect(page.locator('.editor-navigation-status').filter({hasText:'合成版本列表读取失败'})).toBeVisible();await page.unroute(taskUrl,failedTask);
    const failedRead=route=>route.request().method()==='GET'?route.fulfill({status:500,json:{error:'合成重新读取失败'}}):route.continue();await page.route(url,failedRead);
    await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('button',{name:'重新读取',exact:true}).filter({visible:true}).last().click();
    await expect(page.locator('.editor-navigation-status').filter({hasText:'合成重新读取失败'})).toBeVisible();await expect(answer).toContainText(fixture.old.content);await expect(composer()).toHaveValue('重新读取失败时保留的草稿');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
    await page.unroute(url,failedRead);await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('button',{name:'重新读取',exact:true}).filter({visible:true}).last().click();await expect(answer).toContainText('合成新回答');await expect(composer()).toHaveValue('');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
    await page.screenshot({path:path.join(root,`${label}-${name}.png`),fullPage:true});await page.waitForLoadState('networkidle');report.checks.push({label,name,passed:true});console.log(`PASS ${label} ${name}`);continue;
   }
   const before=(await getRagSession(fixture.id)).version,puts=[],baselinePosts=posts.length,baselineStreams=streams;
   const previousTasks=new Set(store.list(fixture.id).map(task=>task.id));let selectedVersion;
   let release,entered;const held=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
   const handler=async route=>{
    if(route.request().method()!=='PUT'){await route.continue();return;}
    puts.push(route.request().postDataJSON());
    if(puts.length===1){entered();await held;
     if(name==='failure'){await route.fulfill({status:500,json:{error:'合成保存失败'}});return;}
     if(name==='uncertain'){const response=await route.fetch();assert.equal(response.status(),200);selectedVersion=(await response.json()).session.version;await route.fulfill({status:500,json:{error:'合成响应丢失'}});return;}
    }
    const response=await route.fetch();if(response.status()===200)selectedVersion=(await response.json()).session.version;await route.fulfill({response});
   };
   await page.route(url,handler);
   await answer.getByRole('button',{name:'上一个回答版本',exact:true}).click();await expect(answer).toContainText(fixture.old.content);
   assert.equal((await getRagSession(fixture.id)).version,before);assert.equal(puts.length,0);
   await composer().fill('请接着说明合成保存。');await expect(send()).toBeEnabled();holdStream=name==='success';
   await send().click();await started;assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
   if(name==='conflict'){
    const external={mutationId:randomUUID(),baseVersion:before,answerMode:fixture.saved.answerMode,messages:[...fixture.saved.messages.slice(0,-1),{...fixture.saved.messages.at(-1),content:'另一客户端保存的合成回答'}]};
    assert.equal((await page.request.put(url,{data:external})).status(),200);
   }
   if(name==='switch'){
    const destination=fixtures.get(`${label}:destination`);await switchTo(destination.id);await composer().fill('另一会话的合成草稿');release();
    await until(()=>getRagSession(fixture.id),saved=>saved.messages.at(-1).id===fixture.old.id);
    await expect(composer()).toHaveValue('另一会话的合成草稿');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
    await switchTo(fixture.id);await expect(composer()).toHaveValue('请接着说明合成保存。');
   }else{
    if(name==='draft-change')await composer().fill('修改后的合成草稿');release();
    if(name==='failure'||name==='uncertain'){
     const retry=page.getByRole('button',{name:'重试保存',exact:true});await expect(retry).toBeVisible();await expect(composer()).toHaveValue('请接着说明合成保存。');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
     if(name==='failure'){
      // The unresolved mutation belongs to the session even when its draft is empty.
      await composer().fill('');await switchTo(fixtures.get(`${label}:destination`).id);await switchTo(fixture.id);await expect(retry).toBeVisible();await expect(composer()).toHaveValue('');await composer().fill('请接着说明合成保存。');
     }
     await retry.click();await until(()=>getRagSession(fixture.id),saved=>saved.messages.at(-1).id===fixture.old.id);await expect(send()).toBeEnabled();assert.equal(puts.length,2);assert.deepEqual(puts[1],puts[0]);assert.equal(posts.length,baselinePosts);await send().click();
    }else if(name==='conflict'){
     await expect(page.getByRole('button',{name:'重试保存',exact:true})).toBeVisible();await expect(composer()).toHaveValue('请接着说明合成保存。');assert.equal((await getRagSession(fixture.id)).messages.at(-1).content,'另一客户端保存的合成回答');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
     await page.getByRole('button',{name:'重新读取会话',exact:true}).click();await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(answer).toContainText('另一客户端保存的合成回答');await expect(composer()).toHaveValue('');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
    }else if(name==='draft-change'){
     await until(()=>getRagSession(fixture.id),saved=>saved.messages.at(-1).id===fixture.old.id);await expect(send()).toBeEnabled();await expect(composer()).toHaveValue('修改后的合成草稿');assert.equal(posts.length,baselinePosts);assert.equal(streams,baselineStreams);
    }
    if(['success','failure','uncertain'].includes(name)){
     await until(()=>posts.length,count=>count===baselinePosts+1);await until(()=>store.list(fixture.id),tasks=>tasks.length===2);
     const task=store.get(store.list(fixture.id).find(task=>!previousTasks.has(task.id)).id);
     assert.equal(task.input.history.at(-1).content,fixture.old.content);
     assert.deepEqual(task.input.history.at(-1).sourceRefs,fixture.old.citations.map(({date,fileName,heading,contentHash})=>({date,fileName,heading,contentHash})));
     assert.equal(task.input.baseVersion,selectedVersion);
     await until(()=>streams,count=>count===baselineStreams+1);
     assert.ok(report.modelRequests.filter(request=>request.stream).at(-1).messages.some(message=>message.role==='assistant'&&message.content.includes(fixture.old.content)));
     if(name==='success'){
      // A later preview cannot rewrite an already accepted task's frozen history.
      const prior=page.locator('.rag-workspace:visible .rag-message-assistant').first();await prior.getByRole('button',{name:'下一个回答版本',exact:true}).click();assert.equal(store.get(task.id).input.history.at(-1).content,fixture.old.content);finish(streams);holdStream=false;
     }
     await until(()=>store.get(task.id),task=>task.state==='succeeded'&&task.saveState==='saved');
     assert.equal(streams,baselineStreams+1);assert.equal(posts.length,baselinePosts+1);
     const canonical=await getRagSession(fixture.id);assert.equal(canonical.messages.at(-3).id,fixture.old.id);assert.equal(canonical.messages.at(-3).content,fixture.old.content);assert.deepEqual(canonical.messages.at(-3).citations,fixture.old.citations);
    }
   }
   await page.screenshot({path:path.join(root,`${label}-${name}.png`),fullPage:true});await page.unroute(url,handler);await page.waitForLoadState('networkidle');report.checks.push({label,name,passed:true});console.log(`PASS ${label} ${name}`);
  }
  if(!process.env.RAG_CONTINUATION_CASE||process.env.RAG_CONTINUATION_CASE==='title-pending'){
   // Real UI submissions launch optional title jobs; holding them must not block continuation.
   holdTitles=true;const baselinePosts=posts.length,baselineStreams=streams;
   if(mobile)await page.getByRole('button',{name:'打开问答历史',exact:true}).click();await page.getByRole('button',{name:'新建问答',exact:true}).filter({visible:true}).click();await composer().fill('合成保存如何进行？');await expect(send()).toBeEnabled();await send().click();
   await until(()=>posts.length,count=>count===baselinePosts+1);const id=posts.at(-1).sessionId;
   await until(()=>store.list(id),tasks=>tasks.length===1&&tasks[0].state==='succeeded'&&tasks[0].saveState==='saved');
   const original=(await getRagSession(id)).messages.at(-1);
   await until(()=>heldTitles.length,count=>count>0);
   await page.locator('.rag-workspace:visible .rag-message-assistant').last().getByRole('button',{name:'重新生成',exact:true}).click();
   await until(()=>store.list(id),tasks=>tasks.length===2&&tasks.every(task=>task.state==='succeeded'&&task.saveState==='saved'));
   const last=page.locator('.rag-workspace:visible .rag-message-assistant').last();await expect(last.locator('.rag-answer-versions')).toHaveText('2 / 2');
   await last.getByRole('button',{name:'上一个回答版本',exact:true}).click();await expect(last).toContainText(original.content.replace(/\[S\d+\]/g,''));
   await composer().fill('请接着说明合成保存。');await send().click();
   await until(()=>posts.length,count=>count===baselinePosts+3,5000);
   await until(()=>store.list(id),tasks=>tasks.length===3&&tasks.every(task=>task.state==='succeeded'&&task.saveState==='saved'));
   const parent=store.get(store.list(id)[0].id).input.history.at(-1);
   assert.equal(streams,baselineStreams+3);assert.equal(parent.content,original.content.replace(/\[S\d+\]/g,'').trim());
   assert.deepEqual(parent.sourceRefs,original.citations.map(({date,fileName,heading,contentHash})=>({date,fileName,heading,contentHash})));
   const canonical=await getRagSession(id);holdTitles=false;for(const respond of heldTitles.splice(0))respond();
   await expect(send()).toBeDisabled();assert.equal((await getRagSession(id)).messages.at(-3).id,original.id);assert.deepEqual((await getRagSession(id)).messages,canonical.messages);
   report.checks.push({label,name:'title-pending',passed:true});console.log(`PASS ${label} title-pending`);
  }
  await page.waitForLoadState('networkidle');await context.close();await browser.close();browser=null;
 }
 assert.equal(await fs.readFile(sourceFile,'utf8'),source);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.errors.push(error.stack);await page?.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 for(const respond of heldTitles.splice(0))respond();await browser?.close();if(web&&web.exitCode===null){const exited=once(web,'close');web.kill();await exited;}
 for(const response of pending.values())response.destroy();await mcp.close();await new Promise(resolve=>model.close(resolve));store.close();
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'server.log'),serverLog);console.log(JSON.stringify({root,passed:report.passed,checks:report.checks.length}));
}

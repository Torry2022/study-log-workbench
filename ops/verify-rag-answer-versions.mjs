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
import {RagTaskStore} from '../study-log-web/lib/rag-task-store.ts';
import {createRagSession,applyRagTaskResult,getRagSession} from '../study-log-web/lib/rag-sessions-store.ts';

const repo=path.resolve(import.meta.dirname,'..'),root=path.join(repo,'.local',`rag-answer-versions-${Date.now()}`),instance=path.join(root,'instance');
await fs.mkdir(root,{recursive:true});await initialize(instance);
const env=parseEnv(await fs.readFile(path.join(instance,'.env'),'utf8'));
process.env.LOG_ROOT=path.join(instance,'data');process.env.BACKUP_ROOT=path.join(instance,'backups');
const source='## 2026-09-01\n\n### 合成来源\n\n合成旧原文。\n\n---\n\n## 2026-09-02\n\n### 合成来源\n\n合成新原文。\n';
await fs.writeFile(path.join(process.env.LOG_ROOT,'2026-09_学习日志.md'),source);
const citation=date=>({sourceId:'S1',date,month:'2026-09',heading:'合成来源',headingIndex:0,fileName:'2026-09_学习日志.md',chunkId:`synthetic-${date}`,contentHash:'synthetic-hash',excerpt:date==='2026-09-01'?'合成旧原文。':'合成新原文。'});
const sid=randomUUID(),q1=randomUUID(),a1={id:randomUUID(),role:'assistant',content:'原始合成回答',citations:[citation('2026-09-01')],status:'complete'};
let session=await createRagSession({id:sid,mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:q1,role:'user',content:'相同的合成问题',status:'complete'},a1]});
const store=new RagTaskStore(process.env.LOG_ROOT),owner=`${process.pid}:versions-fixture`;store.leader(owner);const heartbeat=setInterval(()=>store.leader(owner),500);
for(const regenerate of [true,false]) {
 const input={submissionId:randomUUID(),sessionId:sid,baseVersion:session.version,question:'相同的合成问题',mode:'logs_only',replaceLast:regenerate,history:[]};
 const task=store.create(input,[],regenerate?{questionMessageId:q1,previousAnswer:a1}:{}),claimed=store.claim(owner);assert.equal(claimed.id,task.id);
 const result={answer:regenerate?'第一题的新合成回答':'第二题的合成回答',citations:[citation('2026-09-02')]};store.finish(claimed,'succeeded',result);
 session=await applyRagTaskResult({taskId:task.id,sessionId:sid,baseVersion:input.baseVersion,question:input.question,answerMode:'logs_only',replaceLast:regenerate,...result});store.saved(task.id,'saved');
}
const versionBefore=(await getRagSession(sid)).version;
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}/study-log`,{chromium,webkit,expect}=createRequire(new URL('../study-log-web/package.json',import.meta.url))('@playwright/test');
const safe=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(k)));
const web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,...env,NODE_ENV:'production',LOG_ROOT:process.env.LOG_ROOT,BACKUP_ROOT:process.env.BACKUP_ROOT,CHAT_API_KEY:'',CHAT_LIGHT_API_KEY:''}});
let log='',browser,page;web.stdout.on('data',v=>log+=v);web.stderr.on('data',v=>log+=v);const report={root,checks:[],requests:[],errors:[],paidModelCalls:0};
try {
 await expect.poll(()=>fetch(base).then(r=>r.ok).catch(()=>false),{timeout:30000}).toBe(true);
 for(const [engine,launcher]of [['chromium',chromium],['webkit',webkit]]) {
  browser=await launcher.launch();
  for(const [width,theme]of [[1440,'light'],[390,'dark']]) {
   const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});page=await context.newPage();
   await page.addInitScript(theme=>{localStorage.setItem('study-log-theme',theme);Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>window.__copiedAnswer=value}})},theme);
   page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/rag/'))report.requests.push({method:r.method(),path:new URL(r.url()).pathname})});
   await page.goto(base);await page.getByLabel('访问密码').fill(env.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.workspace')).toBeVisible();await page.waitForLoadState('networkidle');
   await page.goto(`${base}?view=qa&session=${sid}`);
   const workspace=page.locator('.rag-workspace').filter({visible:true}),answers=workspace.locator('.rag-message-assistant'),input=page.getByRole('textbox',{name:'输入知识库问题'});
   await expect(answers).toHaveCount(2);await expect(answers.nth(0)).toContainText('第一题的新合成回答');await expect(answers.nth(0).locator('.rag-answer-versions')).toHaveText('2 / 2');
   await expect(answers.nth(1)).toContainText('第二题的合成回答');await expect(answers.nth(1).locator('.rag-answer-versions')).toHaveCount(0);
   await expect(answers.nth(0).getByRole('button',{name:'重新生成',exact:true})).toHaveCount(0);await expect(answers.nth(1).getByRole('button',{name:'重新生成',exact:true})).toHaveCount(1);
   await expect(page.getByRole('combobox',{name:'查看问答结果'})).toHaveCount(0);
   await answers.nth(0).getByRole('button',{name:'上一个回答版本'}).click();await expect(answers.nth(0)).toContainText('原始合成回答');await expect(answers.nth(0).locator('.rag-citation strong')).toHaveText('2026-09-01');await expect(answers.nth(1)).toContainText('第二题的合成回答');
   await answers.nth(0).getByRole('button',{name:'复制',exact:true}).click();assert.equal(await page.evaluate(()=>window.__copiedAnswer),'原始合成回答');
   await input.fill('保留的合成草稿');await input.press('Enter');await expect(input).toHaveValue('保留的合成草稿');await expect(workspace.getByRole('button',{name:'发送问题'})).toBeDisabled();await expect(input).toHaveAttribute('placeholder','切回当前回答后可继续提问');
   await answers.nth(0).getByRole('button',{name:'下一个回答版本'}).click();await expect(answers.nth(0)).toContainText('第一题的新合成回答');await expect(answers.nth(0).locator('.rag-citation strong')).toHaveText('2026-09-02');await expect(input).toHaveValue('保留的合成草稿');
   await expect(answers.nth(1).getByRole('button',{name:'重新生成',exact:true})).toBeDisabled();await input.fill('');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,`${engine}-${width}-${theme}.png`),fullPage:true});
   await answers.nth(1).getByRole('button',{name:'复制',exact:true}).click();assert.equal(await page.evaluate(()=>window.__copiedAnswer),'第二题的合成回答');
   await page.screenshot({path:path.join(root,`${engine}-${width}-${theme}-footer.png`)});
   await page.waitForLoadState('networkidle');await page.reload();await expect(answers.nth(0).locator('.rag-answer-versions')).toHaveText('2 / 2');await expect(answers.nth(1)).toContainText('第二题的合成回答');
   report.checks.push({engine,width,theme,stableQuestions:true,sourceAndCopyScoped:true,draftProtected:true,reload:true});await page.waitForLoadState('networkidle');await context.close();
  }await browser.close();browser=null;
 }
 assert.equal((await getRagSession(sid)).version,versionBefore);assert.ok(report.requests.every(r=>r.method==='GET'));assert.deepEqual(report.errors,[]);assert.equal(await fs.readFile(path.join(process.env.LOG_ROOT,'2026-09_学习日志.md'),'utf8'),source);report.passed=true;
}catch(e){report.passed=false;report.errors.push(e.stack);await page?.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
finally{await browser?.close();if(web.exitCode===null){const closed=once(web,'close');web.kill();await closed;}clearInterval(heartbeat);store.shutdown(owner);store.close();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'server.log'),log);console.log(JSON.stringify({root,passed:report.passed,checks:report.checks.length}));}

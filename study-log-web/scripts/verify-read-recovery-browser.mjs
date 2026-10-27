import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const out=process.env.READ_RECOVERY_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'study-log-read-recovery-'));
await fs.mkdir(out,{recursive:true});
const cwd=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const{chromium,webkit,expect}=createRequire(cwd+'/package.json')('@playwright/test');
const fixture=await fs.mkdtemp(path.join(out,'instance-'));
await fs.writeFile(fixture+'/2026-01_学习日志.md','## 2026-01-15\n\n### 1. 恢复验收记录\n\n这里是独立合成资料，仅用于验证读取恢复。\n');
await fs.writeFile(fixture+'/.instance.json',JSON.stringify({schemaVersion:1,id:randomUUID()}));
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base=`http://127.0.0.1:${port}/study-log`;
const env={...process.env,LOG_ROOT:fixture,BACKUP_ROOT:fixture+'/.backups',APP_PASSWORD:'synthetic-recovery-password',SESSION_SECRET:'synthetic-local-recovery-session',COOKIE_SECURE:'false',RAG_RUNTIME:'legacy',DEEPSEEK_API_KEY:'synthetic-never-call',DEEPSEEK_MODEL:'synthetic',DEEPSEEK_BASE_URL:'http://127.0.0.1:9/chat',STUDY_LOG_MCP_URL:'http://127.0.0.1:9/mcp',STUDY_LOG_MCP_TOKEN:'synthetic',NEXT_TELEMETRY_DISABLED:'1'};
let logs='',app,browser;const report={passed:false,cases:[],errors:[],writes:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd,env,windowsHide:true});app.stdout.on('data',c=>logs+=c);app.stderr.on('data',c=>logs+=c);
 let ready=false;for(let n=0;n<120;n++){try{if((await fetch(base)).status===200){ready=true;break}}catch{}await pause(150)}assert.ok(ready,logs);
 for(const[engine,launcher]of Object.entries({chromium,webkit})){
 browser=await launcher.launch();const context=await browser.newContext({viewport:{width:1440,height:900}});
 assert.ok((await context.request.post(base+'/api/auth/login',{data:{password:env.APP_PASSWORD}})).ok());
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))report.writes.push({method:r.method(),path:new URL(r.url()).pathname})});
 let statsReads=0,statsOffline=false;
 await page.route('**/api/stats?*',async route=>{statsReads++;if(statsOffline||statsReads===1)return route.fulfill({status:503,json:{error:'合成统计持续不可用'}});return route.continue()});
 await page.goto(base+'?view=stats&month=2026-01');await expect(page.getByText('学习日历',{exact:true})).toBeVisible();assert.equal(statsReads,2);
 statsOffline=true;await page.reload();await expect(page.getByText('合成统计持续不可用',{exact:true})).toBeVisible();assert.equal(statsReads,4);await page.screenshot({path:out+`/browser-${engine}-stats-failure.png`});
 statsOffline=false;await page.getByRole('button',{name:/^(重试|刷新)$/}).first().click();await expect(page.getByText('学习日历',{exact:true})).toBeVisible();
 let taskReads=0,taskOffline=false;
 await page.route('**/api/rag/tasks',async route=>{taskReads++;if(taskOffline||taskReads===1)return route.fulfill({status:502,json:{error:'合成任务持续不可用'}});return route.fulfill({json:{tasks:[]}})});
 await page.route('**/api/capabilities',async route=>{const response=await route.fetch();const body=await response.json();body.features.ragTasks={supported:true,configured:true,protocolVersion:1,questionEditing:true};body.features.rag={supported:true,configured:true};await route.fulfill({response,json:body})});
 await page.goto(base+'?view=qa');await expect(page.getByRole('textbox',{name:'输入知识库问题',exact:true})).toBeVisible();await expect.poll(()=>taskReads).toBe(2);await pause(1500);await expect(page.getByRole('alert').filter({hasText:'合成任务持续不可用'})).toHaveCount(0);assert.equal(taskReads,2);
 taskOffline=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.getByRole('alert').filter({hasText:'合成任务持续不可用'})).toBeVisible();const down=taskReads;assert.ok(down>=4);await page.screenshot({path:out+`/browser-${engine}-qa-failure.png`});
 await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.getByRole('alert').filter({hasText:'合成任务持续不可用'})).toBeVisible();const close=page.locator('.sidebar.mobile-open').getByRole('button',{name:'关闭左侧导航',exact:true});if(await close.count()){await close.click();await page.waitForTimeout(350);}await expect(page.getByRole('alert').filter({hasText:'合成任务持续不可用'})).toBeVisible();await page.waitForTimeout(400);await expect(page.locator('.sidebar.mobile-open')).toHaveCount(0);await page.screenshot({path:out+`/browser-${engine}-qa-mobile-failure.png`});
 taskOffline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.getByRole('alert').filter({hasText:'合成任务持续不可用'})).toHaveCount(0);await expect.poll(()=>taskReads).toBeGreaterThan(down);
 const beforeHidden=taskReads;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await pause(2200);assert.equal(taskReads,beforeHidden);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>taskReads).toBeGreaterThan(beforeHidden);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 report.cases.push({engine,singleFailureRecovered:true,persistentOutageVisible:true,statsRecovered:true,taskRecovered:true,idlePollingReduced:true,hiddenPaused:true,foregroundReconciled:true});await context.close();await browser.close();browser=null;
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.passed=true;
}finally{if(browser)await browser.close();if(app){const stopped=once(app,'close');app.kill();await stopped}await fs.writeFile(out+'/browser-server.log',logs);await fs.writeFile(out+'/browser-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}

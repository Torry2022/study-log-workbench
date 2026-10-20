import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { initialize } from '../../ops/instance.mjs';

const repo=path.resolve(import.meta.dirname,'../..'),root=path.join(repo,'.local',`mermaid-error-isolation-${Date.now()}`),instance=path.join(root,'instance');
await fs.mkdir(root,{recursive:true});await initialize(instance);
const environment=parseEnv(await fs.readFile(path.join(instance,'.env'),'utf8')),data=path.join(instance,'data');
const invalid='flowchart TD\nA[',valid='flowchart TD\nA[正常图表] --> B[继续阅读]';
const markdown=chart=>'```mermaid\n'+chart+'\n```';
const source='## 2026-09-01\n\n### 1. 错误图表合成\n\n'+markdown(invalid)+'\n\n---\n\n## 2026-09-02\n\n### 1. 正常图表合成\n\n'+markdown(valid)+'\n';
const sourceFile=path.join(data,'2026-09_学习日志.md');await fs.writeFile(sourceFile,source);
const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}/study-log`,{chromium,webkit,expect}=createRequire(new URL('../package.json',import.meta.url))('@playwright/test');
const safe=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const report={root,checks:[],observations:[],errors:[],paidCalls:0};let browser,web,log='';
async function ready(){for(let n=0;n<400;n++){if(await fetch(base).then(r=>r.ok).catch(()=>false))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Synthetic service did not start');}
try{
  web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,...environment,LOG_ROOT:data,BACKUP_ROOT:path.join(instance,'backups'),NODE_ENV:'production',CHAT_API_URL:'',CHAT_API_KEY:'',CHAT_MODEL:'',STUDY_LOG_MCP_URL:'',STUDY_LOG_MCP_TOKEN:''}});
  web.stdout.on('data',b=>log+=b);web.stderr.on('data',b=>log+=b);await ready();
  for(const[engine,launcher]of[['chromium',chromium],['webkit',webkit]])for(const mobile of[false,true])for(const theme of['light','dark']){
    const label=`${engine}-${mobile?'phone':'desktop'}-${theme}`;if(process.env.MERMAID_ONLY&&process.env.MERMAID_ONLY!==label)continue;
    browser=await launcher.launch();const context=await browser.newContext({viewport:{width:mobile?390:1440,height:mobile?844:900},isMobile:mobile,hasTouch:mobile});
    await context.addInitScript(theme=>localStorage.setItem('study-log-theme',theme),theme);
    const page=await context.newPage();await page.goto(base);await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.workspace')).toBeVisible();await page.waitForLoadState('networkidle');
    const sessions={};for(const[name,chart]of[['invalid',invalid],['valid',valid]]){const response=await page.request.post(base+'/api/rag/sessions',{data:{id:randomUUID(),mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:randomUUID(),role:'user',content:'图表合成'+name,status:'complete'},{id:randomUUID(),role:'assistant',content:markdown(chart),status:'complete',citations:[]}]}});assert.equal(response.status(),200);sessions[name]=(await response.json()).session.id;}
    // Keep the same document while navigating: a reload would hide leaked body nodes.
    const navigate=query=>page.evaluate(query=>{history.pushState({...history.state,studyLogIndex:(history.state?.studyLogIndex||0)+1},'',location.pathname+'?'+query);dispatchEvent(new PopStateEvent('popstate'));},query);
    const inspect=async(mode,stage)=>{const nodes=await page.evaluate(()=>[...document.body.children].filter(el=>/^d?mermaid-|^imermaid-/.test(el.id)).map(el=>({id:el.id,height:el.getBoundingClientRect().height,text:el.textContent?.slice(-120)})));report.observations.push({label,mode,stage,nodes});if(nodes.length)report.errors.push({label,mode,stage,nodes});};
    for(const mode of['log','qa']){
      await page.goto(mode==='log'?base+'?date=2026-09-01':base+'?view=qa&session='+sessions.invalid);
      const preview=mode==='log'?page.locator('.reader .markdown-preview').filter({visible:true}).first():page.locator('.rag-workspace').filter({visible:true}).locator('.rag-answer .markdown-preview');
      await expect(preview.locator('pre.code-block')).toContainText(invalid);await inspect(mode,'invalid fallback');
      await navigate(mode==='log'?'date=2026-09-02':'view=qa&session='+sessions.valid);await expect(preview.locator('svg[data-mermaid-rendered]')).toBeVisible();await inspect(mode,'valid replacement');
      await page.screenshot({path:path.join(root,label+'-'+mode+'-valid.png')});
      await navigate('view=notes');await expect(page.locator('.view-notes')).toBeVisible();await inspect(mode,'module switch');
      report.checks.push(label+': '+mode+' malformed fallback, valid replacement and module switch');
    }
    await context.close();await browser.close();browser=null;
  }
  assert.equal(await fs.readFile(sourceFile,'utf8'),source);assert.deepEqual(report.errors,[],'Mermaid may not leave external rendering/error nodes in body');report.passed=true;
}catch(e){report.failure=String(e.stack);throw e;}
finally{await browser?.close();if(web){const stopped=once(web,'close');web.kill();await stopped;}await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'web.log'),log);console.log(JSON.stringify({root,passed:report.passed,checks:report.checks.length,errors:report.errors.length}));}

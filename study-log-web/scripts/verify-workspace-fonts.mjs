// Production styles and real bundled fonts; no model or production data access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createRequire} from 'node:module';
const app=process.env.WORKSPACE_FONT_APP;assert.ok(app&&path.isAbsolute(app));
const output=process.env.WORKSPACE_FONT_OUTPUT;assert.ok(output&&path.isAbsolute(output));await fs.mkdir(output,{recursive:true});
const require=createRequire(path.join(app,'package.json'));const {chromium,webkit}=require('@playwright/test');
const data=await fs.mkdtemp(path.join(os.tmpdir(),'study-log-fonts-'));
const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const safe=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(k)));
let logs='',browser;const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,NODE_ENV:'production',LOG_ROOT:data,STUDY_LOG_INSTANCE_ROOT:data,APP_PASSWORD:'synthetic-font-password',SESSION_SECRET:'synthetic-font-session',COOKIE_SECURE:'false'}});
server.stdout.on('data',s=>logs+=s);server.stderr.on('data',s=>logs+=s);
const url=`http://127.0.0.1:${port}/study-log`,results=[];
const fixture=`<style>@media(min-width:768px){#mobile-date-wrapper{display:none}}</style><main style="padding:24px;max-width:1100px;margin:auto"><div id="mobile-date-wrapper" class="mobile-log-identity"><strong id="mobile-date">2026-10-27</strong></div><div class="reader-toolbar"><h2 id="date">2026-10-27</h2></div><div class="markdown-preview" style="padding:16px 0"><h3 id="heading">分词器（Tokenizer）概述</h3><p id="body">学习日志、问答与统计使用统一字体。中文与 Latin 123。</p><p><code id="code">tokenize(input)</code></p><pre class="code-block"><code id="block">const tokens = tokenize(input);</code></pre></div><nav id="ui">日志　随记　收藏　Wiki　问答　统计</nav></main>`;
try{
 for(let i=0;;i++){try{if((await fetch(url)).ok)break;}catch{}if(i>150||server.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  browser=await launcher.launch();const context=await browser.newContext();const page=await context.newPage();const requests=[],errors=[];
  page.on('request',r=>{if(r.url().includes('/fonts/'))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  const stylesheets=await page.locator('link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(n=>n.href));assert.ok(stylesheets.length);
  await context.route('**/__font_fixture',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang=zh-CN><head><meta charset=utf-8>'+stylesheets.map(href=>`<link rel=stylesheet href="${href}">`).join('')+'</head><body>'+fixture+'</body></html>'}));
  await page.goto(url+'/__font_fixture');await page.evaluate(()=>document.fonts.ready);
  const expected={date:'Study Log Latin Serif',heading:'Study Log Latin Serif',body:'Study Log UI Latin',ui:'Study Log UI Latin',code:'Study Log Code',block:'Paper Mono'};
  for(const width of [1440,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   const styles=await page.evaluate(()=>Object.fromEntries(['date','heading','body','ui','code','block'].map(id=>{const n=document.getElementById(id),s=getComputedStyle(n);return[id,{family:s.fontFamily,weight:s.fontWeight,width:n.getBoundingClientRect().width}]})));
   for(const [id,name] of Object.entries(expected))assert.ok(styles[id].family.includes(name),`${engine} ${id}: ${styles[id].family}`);
   if(width===390){assert.ok((await page.locator('#mobile-date').evaluate(n=>getComputedStyle(n).fontFamily)).includes('Study Log Latin Serif'));assert.ok((await page.locator('#mobile-date').boundingBox()).height>0);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(output,`${engine}-${width}-${theme}.png`)});results.push({engine,width,theme,styles});
  }
  for(const name of ['Gelasio.ttf','Inter.woff2','NotoSansSC-Common.woff2','NotoSerifSC-Common.woff2','JetBrainsMono.ttf','PaperMono.woff2'])assert.ok(requests.some(u=>u.endsWith('/'+name)),`${engine}: missing ${name}`);
  assert.ok(!requests.some(u=>/\/Noto(?:Sans|Serif)SC\.woff2$/.test(u)),'ordinary text must not download the full CJK font');
  if(engine==='chromium'){
   await page.setViewportSize({width:1440,height:900});await page.locator('#date').boundingBox();
   const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');
   for(const id of ['date','heading','body','ui','code','block']){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#'+id});const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});assert.ok(fonts.length>0&&fonts.every(f=>f.isCustomFont),`${id}: system font leaked ${JSON.stringify(fonts)}`);results.push({engine,id,renderedFonts:fonts});}
  }
  await page.evaluate(()=>{const n=document.createElement('p');n.id='rare';n.style.fontFamily='var(--font-display)';n.textContent='㐂';document.body.append(n);});await page.locator('#rare').boundingBox();await page.evaluate(()=>document.fonts.load('400 16px "Study Log Serif"','㐂'));await page.evaluate(()=>document.fonts.ready);
  assert.ok(requests.some(u=>u.endsWith('/NotoSerifSC.woff2')),'uncommon CJK must load the complementary font');assert.deepEqual(errors,[]);
  const failureContext=await browser.newContext();await failureContext.route('**/__font_fixture',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang=zh-CN><head><meta charset=utf-8>'+stylesheets.map(href=>`<link rel=stylesheet href="${href}">`).join('')+'</head><body>'+fixture+'</body></html>'}));const failure=await failureContext.newPage();await failure.route('**/fonts/**',r=>r.abort());await failure.goto(url+'/__font_fixture');assert.ok((await failure.locator('#heading').innerText()).includes('分词器'));assert.ok((await failure.locator('#date').boundingBox()).height>0);await failureContext.close();
  await context.close();await browser.close();browser=null;
 }
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,app,results,checks:['actual production font CSS','two engines / two widths / light and dark','custom rendered fonts without host OS dependency','common versus uncommon unicode loading','font failure remains readable']},null,2));console.log(JSON.stringify({passed:true,states:8,output}));
}finally{await browser?.close();if(server.exitCode===null){server.kill();await once(server,'exit');}await fs.writeFile(path.join(output,'server.log'),logs);}

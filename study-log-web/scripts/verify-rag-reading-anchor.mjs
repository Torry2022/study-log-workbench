// Adapted from the personal edition: public instance initialization, MCP API and model configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { initialize } from '../../ops/instance.mjs';
import { parseEnv } from 'node:util';

// Current production UI/API, real local MCP and SQLite/JSON; only the model is a loopback substitute.
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `rag-reading-anchor-${Date.now()}`);
const instance = path.join(root, 'instance'), data = path.join(instance, 'data');
await fs.mkdir(root, { recursive: true }); await initialize(instance);
const environment = parseEnv(await fs.readFile(path.join(instance, '.env'), 'utf8'));
process.env.DASHSCOPE_API_KEY = ''; process.env.RERANK_ENABLED = 'false'; process.env.STUDY_LOG_INDEX_ROOT = path.join(root, 'index');
const source = '## 2026-09-01\n\n### 1. 合成保存\n\n合成保存需要先确认内容，再保存到当前日志。\n';
const sourceFile = path.join(data, '2026-09_学习日志.md'); await fs.writeFile(sourceFile, source);
const report = { checks: [], requests: [], modelRequests: [], errors: [], root };
const record = name => { report.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, accept, timeout = 20000) {
  const start = Date.now(); while (true) { const value = await read(); if (accept(value)) return value; if (Date.now() - start > timeout) throw Error(`Timed out: ${JSON.stringify(value)}`); await pause(40); }
}
let streams = 0, active = 0, peak = 0, web, holdTitles = false;
const heldTitles = [];
const pending = new Map(), imageWaiters=new Map(), releasedImages=new Set();
const imageBody='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="600"><rect width="100" height="600" fill="#eee"/></svg>';
const releaseImage=key=>{releasedImages.add(key);for(const response of imageWaiters.get(key)||[]){if(!response.destroyed){response.writeHead(200,{'content-type':'image/svg+xml','cache-control':'no-store'});response.end(imageBody);}}imageWaiters.delete(key);};
const model = http.createServer(async (req, res) => {
  if(req.url.startsWith('/reading-image/')){const key=req.url.slice('/reading-image/'.length);const list=imageWaiters.get(key)||[];list.push(res);imageWaiters.set(key,list);if(releasedImages.has(key))releaseImage(key);return;}
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); report.modelRequests.push({ stream: body.stream === true, model: body.model });
  if (!body.stream) {
    const title = body.messages?.[0]?.content?.includes('短语式标题');
    const respond = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: title ? '合成保存问答' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); };
    if (title && holdTitles) heldTitles.push(respond); else respond(); return;
  }
  const n = ++streams; active++; peak = Math.max(peak, active); pending.set(n, res);
  res.setHeader('content-type', 'text/event-stream'); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `第${n}次合成回答：先确认内容` }, finish_reason: null }] })}\n\n`);
  res.once('close', () => { active--; pending.delete(n); });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = n => {
  const res = pending.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
};
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-browser-task-mcp', retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, require = createRequire(new URL('../package.json',import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
let serverLog = '', currentPage, browser;
try {
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
    CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-browser-model-key', CHAT_MODEL: 'synthetic-browser-model', CHAT_LIGHT_MODEL: 'synthetic-browser-model',
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-browser-task-mcp', WIKI_JEV_API_KEY: '', WIKI_COMPILE_TOKEN: '', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } });
  web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
  await until(async () => fetch(base).then(r => r.ok).catch(() => false), Boolean);
  for (const [engine, launcher, mobile] of [['chromium', chromium, false], ['chromium', chromium, true], ['webkit', webkit, false], ['webkit', webkit, true]]) {
    const label = `${engine}-${mobile ? 'phone' : 'desktop'}`;
    if (process.env.RAG_LIVE_ONLY && process.env.RAG_LIVE_ONLY !== label) continue;
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => {
      window.readingDiagnostics=[];
      const trace=value=>{if(window.readingDiagnostics.length<2000)window.readingDiagnostics.push({t:performance.now(),...value});};
      const originalHit=document.elementFromPoint.bind(document);
      document.elementFromPoint=(x,y)=>{const hit=originalHit(x,y);trace({kind:'hit',x,y,tag:hit?.tagName,classes:String(hit?.className),preview:Boolean(hit?.closest('.markdown-preview')),overflow:getComputedStyle(document.body).overflowY});return hit;};
      const originalCaret=document.caretRangeFromPoint.bind(document);
      document.caretRangeFromPoint=(x,y)=>{const range=originalCaret(x,y);trace({kind:'caret',x,y,tag:range?.startContainer.parentElement?.tagName,offset:range?.startOffset,preview:Boolean(range?.startContainer.parentElement?.closest('.markdown-preview'))});return range;};
      const originalBy=window.scrollBy.bind(window);
      window.scrollBy=(...args)=>{const before=scrollY,result=originalBy(...args);if(typeof args[0]==='object')trace({kind:'restore',before,after:scrollY,delta:args[0].top});return result;};
      const NativeResize=window.ResizeObserver;
      window.ResizeObserver=class extends NativeResize{constructor(callback){super((entries,observer)=>{for(const entry of entries)if(entry.target.matches('.rag-workspace,.rag-message-list'))trace({kind:'resize',target:entry.target.className,height:entry.contentRect.height,doc:document.documentElement.scrollHeight});callback(entries,observer);});}};
      window.eventFrames = [];
      const NativeEventSource = window.EventSource;
      window.EventSource = class extends NativeEventSource {
        constructor(...args) {
          super(...args);
          this.addEventListener('snapshot', event => {
            const { task } = JSON.parse(event.data);
            window.eventFrames.push({ revision: task.revision, bytes: new TextEncoder().encode(event.data).length,
              partial: task.partial.length, previous: task.previousAnswer?.content.length || 0, previousContent: task.previousAnswer?.content || '' });
          });
        }
      };
      window.followCalls = 0;
      window.followTrace = [];
      addEventListener('scroll', () => { window.followTrace.push({ y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight, calls: window.followCalls }); window.followTrace = window.followTrace.slice(-30); }, { passive: true });
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(...args) { if (this.classList.contains('rag-scroll-anchor')) window.followCalls++; window.followTrace.push({ type: 'scrollIntoView', className: this.className, stack: new Error().stack }); return original.apply(this, args); };
    });
    const page = await context.newPage(); currentPage = page;
    const navigations = [], unhandled = [];
    const navigate = async url => {
      const entry = { startedAt: Date.now(), endedAt: null }; navigations.push(entry);
      try { return await (url ? page.goto(url) : page.reload()); } finally { entry.endedAt = Date.now(); }
    };
    await page.exposeFunction('captureLiveFollowUnhandled', value => unhandled.push(value));
    await page.addInitScript(() => addEventListener('unhandledrejection', event => { void window.captureLiveFollowUnhandled({ message: String(event.reason), stack: event.reason?.stack }); }));
    const cdp = mobile && engine === 'chromium' ? await context.newCDPSession(page) : null;
    const gesture = async delta => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
        for (let step = 1; step <= 4; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 - delta * step / 4 }] }); await pause(20);
        }
        await pause(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      else if (mobile) await page.evaluate(delta => {
        // Match the non-editable reading surface receiving a touch gesture.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const emit = (name, y) => { const event = new Event(name); Object.defineProperty(event, 'touches', { value: [{ clientY: y }] }); window.dispatchEvent(event); };
        emit('touchstart', 400); emit('touchmove', 400 - delta); window.scrollBy(0, delta); emit('touchend', 400 - delta);
      }, delta);
      else await page.mouse.wheel(0, delta);
    };
    (report.inputCoverage ||= []).push({ label, input: cdp ? 'Chromium CDP native touch gesture' : mobile ? 'WebKit synthetic touch events plus scrollBy (not native touch)' : 'browser wheel input' });
    let eventConnections = 0;const eventUrls=[];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/api/rag/')) report.requests.push({ label, path: url.pathname, method: request.method(), after: url.searchParams.get('after') });
      if (url.pathname.endsWith('/events')) {eventConnections++;eventUrls.push(request.url());}
    });
    const pageErrors = []; page.on('pageerror', error => pageErrors.push({ at: Date.now(), message: error.message, stack: error.stack }));
    await navigate(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '问答', exact: true }).click();
    if(!report.historySeeded){
      for(let index=0;index<26;index++){
        const response=await page.request.post(`${base}/api/rag/sessions`,{data:{id:randomUUID(),mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:randomUUID(),role:'user',content:'独立历史列表合成问题'+index,status:'complete'},{id:randomUUID(),role:'assistant',content:'独立历史列表合成回答'+index,status:'complete'}]}});assert.equal(response.status(),200);
      }
      report.historySeeded=true;await navigate(`${base}?view=qa`);
    }

    const workspace = page.locator('.rag-workspace').filter({ visible: true });
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    await expect(input).toBeEnabled();
    const fresh = async () => {
      if (mobile && !await page.locator('.sidebar.mobile-open').count()) await page.getByRole('button', { name: '打开问答历史', exact: true }).click();
      await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click();
    };
    await fresh();
    await expect(workspace.locator('.rag-message')).toHaveCount(0);
    const run = async (name, work) => {
      try { await work(); record(`${label}: ${name}`); }
      catch (error) { report.errors.push({ engine: label, name, error: error.stack, scrollTrace: await page.evaluate(() => window.followTrace) }); console.error(`FAIL ${label}: ${name}: ${error.message}`); }
    };
    await input.fill('合成保存时如何确认内容？');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await until(() => streams, n => pending.has(n)); const n = streams;
    const write = text => pending.get(n).write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
    await run('a real unfinished model fragment is visible before the next one-second reconciliation', async () => {
      await expect(workspace.locator('.rag-answer')).toContainText(`第${n}次合成回答`, { timeout: 700 });
      assert.ok(eventConnections > 0, 'visible updates must subscribe to the existing event stream');
    });

    // Independent visual oracle: choose a character in the first fully visible
    // text line, then resolve its row/paragraph plus text offset after DOM rebuilds.
    await page.evaluate(()=>{
      window.readingHeader=()=>Math.max(0,...[...document.querySelectorAll('.reader-toolbar,.mobile-topbar')].map(el=>{const r=el.getBoundingClientRect();return r.top<=1&&r.height?r.bottom:0;}));
      window.readingRange=(element,offset)=>{const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){if(offset<node.length){const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);return range;}offset-=node.length;}throw Error('Reading character disappeared');};
      window.readingElement=target=>target.kind==='table'?document.querySelectorAll('.rag-answer tbody tr')[target.row]?.cells[target.col]:[...document.querySelectorAll('.rag-answer p')].find(p=>p.textContent.startsWith(target.prefix));
      window.readingMeasure=()=>{const target=window.readingTarget,element=window.readingElement(target),r=window.readingRange(element,target.offset).getBoundingClientRect();return {t:performance.now(),top:r.top,bottom:r.bottom,text:element.textContent.slice(target.offset,target.offset+8),y:scrollY,calls:window.followCalls,width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height,viewport:innerHeight,header:window.readingHeader()};};
      window.pickReading=kind=>{
        const candidates=kind==='table'?[...document.querySelectorAll('.rag-answer tbody tr')].map((row,index)=>({element:row.cells[0],target:{kind,row:index,col:0}})):[...document.querySelectorAll('.rag-answer p')].filter(p=>p.textContent.startsWith('阅读段')).map(p=>({element:p,target:{kind,prefix:p.textContent.split('：')[0]+'：'}}));
        const top=window.readingHeader();
        for(const {element,target}of candidates){const box=element.getBoundingClientRect();if(box.bottom<=top||box.top>=innerHeight)continue;const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node,offset=0;while(node=walk.nextNode()){const whole=document.createRange();whole.selectNodeContents(node);const line=[...whole.getClientRects()].find(r=>r.top>=top+1&&r.bottom<innerHeight-180);if(line){const caret=document.caretRangeFromPoint(line.left+2,line.top+line.height/2);if(caret?.startContainer===node){window.readingTarget={...target,offset:offset+Math.min(caret.startOffset,node.length-1)};return window.readingMeasure();}}offset+=node.length;}}throw Error('No visible reading character');
      };
    });
    const measure=()=>page.evaluate(()=>window.readingMeasure());
    const recordAnchor=(name,before,after)=>{(report.readingAnchors ||= []).push({label,name,before,after});assert.equal(after.text,before.text,'same logical character after Markdown DOM rebuild');assert.equal(after.calls,before.calls,'paused reading cannot invoke bottom following');};
    await run('paused table reading keeps a visible character across column reflow',async()=>{
      const table='\n\n| 左列 | 右列 |\n| --- | --- |\n'+Array.from({length:36},(_,i)=>'| 第'+i+'行 '+ '需要保持阅读位置的正文。'.repeat(10)+' | 短 |').join('\n')+'\n| 最后行 | ';
      write(table);await expect(workspace.locator('tbody tr')).toHaveCount(37);await pause(450);
      await page.evaluate(()=>{const row=document.querySelectorAll('.rag-answer tbody tr')[15];scrollTo(0,scrollY+row.getBoundingClientRect().top-200);});await gesture(-20);await pause(200);
      const before=await page.evaluate(()=>window.pickReading('table'));
      write('另一列后续输出的很长正文。'.repeat(100)+' |\n');await expect(workspace.locator('tbody tr').last()).toContainText('另一列后续输出');await pause(650);
      const after=await measure();recordAnchor('table expansion',before,after);assert.ok(after.width<before.width-20,'actual table column reflow occurred');assert.ok(after.top>=after.header-30&&after.bottom<after.viewport-160,'same reading character remains visible, not just unchanged scrollY');
    });
    await run('reading inside a tall table cell survives reverse reflow and completion',async()=>{
      await page.evaluate(()=>{const cell=document.querySelectorAll('.rag-answer tbody tr')[15].cells[0];const r=cell.getBoundingClientRect();scrollTo(0,scrollY+r.top+r.height*.55-100);});await gesture(-20);await pause(180);
      const before=await page.evaluate(()=>window.pickReading('table'));const target=await page.evaluate(()=>window.readingTarget);assert.ok(target.offset>10,'anchor is within a wrapped cell, not the table top');
      write('| '+'左侧后续输出的很长正文。'.repeat(120)+' | 短 |\n');await expect(workspace.locator('tbody tr')).toHaveCount(38);await pause(650);
      const after=await measure();recordAnchor('table contraction',before,after);assert.ok(after.width>before.width+10,'opposite column reflow occurred');assert.ok(after.top>=after.header-30&&after.bottom<after.viewport-160,'within-cell reading character stays visible after contraction');
      finish(n);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await pause(350);const completed=await measure();recordAnchor('completion/status',after,completed);assert.ok(Math.abs(completed.top-after.top)<3,'completion metadata preserves reading line');
    });
    await run('an asynchronous Mermaid render above paused reading preserves its character',async()=>{
      let released=false;const gates=[];const pattern='**/_next/static/chunks/*.js';
      const hold=async route=>{if(!released)await new Promise(resolve=>gates.push(resolve));await route.continue();};
      await page.route(pattern,hold);
      let diagramTask;
      try{
        await expect(input).toBeEnabled();await fresh();await input.fill('合成保存异步图表');await page.getByRole('button',{name:'发送问题',exact:true}).click();await until(()=>streams,value=>pending.has(value));diagramTask=streams;
        const chart='flowchart TD\n'+Array.from({length:32},(_,i)=>`node${i}[阶段${i}] --> node${i+1}[阶段${i+1}]`).join('\n');
        const body='\n\n```mermaid\n'+chart+'\n```\n\n'+Array.from({length:28},(_,i)=>'阅读段'+i+'：'+ '这是异步图表下方的真实合成段落。'.repeat(8)+'\n\n').join('');
        pending.get(diagramTask).write(`data: ${JSON.stringify({choices:[{delta:{content:body},finish_reason:null}]})}\n\n`);
        await expect(workspace.locator('.rag-answer')).toContainText('阅读段27');await until(()=>gates.length,value=>value>0);await pause(350);
        await page.evaluate(()=>{const p=[...document.querySelectorAll('.rag-answer p')].find(p=>p.textContent.startsWith('阅读段8：'));scrollTo(0,scrollY+p.getBoundingClientRect().top-170);});await gesture(-20);await pause(180);
        const before=await page.evaluate(()=>window.pickReading('paragraph')),height=await workspace.locator('.mermaid-block').evaluate(el=>el.getBoundingClientRect().height);
        released=true;for(const release of gates)release();
        await expect(workspace.locator('svg[data-mermaid-rendered]')).toBeVisible();await pause(350);
        const after=await measure();recordAnchor('delayed Mermaid layout',before,after);assert.ok((await workspace.locator('.mermaid-block').evaluate(el=>el.getBoundingClientRect().height))>height+200,'real asynchronous graph obtains its intrinsic height');assert.ok(Math.abs(after.top-before.top)<3,'asynchronous SVG layout keeps the same reading line in place');
        finish(diagramTask);diagramTask=null;await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
      }finally{released=true;for(const release of gates)release();await page.unroute(pattern,hold);if(diagramTask&&pending.has(diagramTask))finish(diagramTask);}
    });
    const imageCase=async follow=>{
      await expect(input).toBeEnabled();await fresh();await input.fill('合成保存延迟图片');await page.getByRole('button',{name:'发送问题',exact:true}).click();await until(()=>streams,value=>pending.has(value));const imageTask=streams,key=randomUUID();
      const body='\n\n![延迟图片](http://127.0.0.1:'+model.address().port+'/reading-image/'+key+')\n\n'+Array.from({length:28},(_,i)=>'阅读段'+i+'：'+ '这是异步图片下方的真实合成段落。'.repeat(8)+'\n\n').join('');
      pending.get(imageTask).write(`data: ${JSON.stringify({choices:[{delta:{content:body},finish_reason:null}]})}\n\n`);await expect(workspace.locator('.rag-answer')).toContainText('阅读段27');await pause(350);
      await page.evaluate(()=>scrollTo(0,0));await until(()=>imageWaiters.get(key)?.some(res=>!res.destroyed),Boolean);
      if(follow){await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await pause(200);}else{await page.evaluate(()=>{const p=[...document.querySelectorAll('.rag-answer p')].find(p=>p.textContent.startsWith('阅读段8：'));scrollTo(0,scrollY+p.getBoundingClientRect().top-170);});await gesture(-20);await pause(180);}
      try {
      const before=follow?await page.evaluate(()=>({height:document.documentElement.scrollHeight,y:scrollY,calls:window.followCalls})):await page.evaluate(()=>window.pickReading('paragraph'));
      if(!follow&&!mobile){
        const history=page.locator('.rag-history-groups').filter({visible:true}).first();await history.evaluate(el=>{el.scrollTop=100;});const box=await history.boundingBox();const mainY=await page.evaluate(()=>scrollY),listY=await history.evaluate(el=>el.scrollTop);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,100);await pause(100);assert.equal(await page.evaluate(()=>scrollY),mainY);assert.ok((await history.evaluate(el=>el.scrollTop))>listY,'real history list consumes this wheel gesture');
      }
      releaseImage(key);await expect(workspace.getByAltText('延迟图片')).toHaveJSProperty('naturalHeight',600);await pause(450);
      if(follow){const after=await page.evaluate(()=>({height:document.documentElement.scrollHeight,y:scrollY,calls:window.followCalls,remaining:document.documentElement.scrollHeight-scrollY-innerHeight}));(report.imageFollowing ||= []).push({label,before,after});assert.ok(after.height>before.height+500);assert.ok(after.remaining<40,'asynchronous image height alone keeps following latest output');assert.ok(after.calls>before.calls);}else{const after=await measure();recordAnchor('delayed intrinsic image',before,after);assert.ok(after.y>before.y+500,'real resource added height above the reader');assert.ok(Math.abs(after.top-before.top)<3,'delayed image keeps the same visible line in place');}
      if(follow){
        const emit=text=>pending.get(imageTask).write(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`);
        emit('\n\n| 左列 | 右列 |\n| --- | --- |\n'+Array.from({length:36},(_,i)=>'| 跟随行'+i+' '+ '需要保持阅读位置的正文。'.repeat(10)+' | 短 |').join('\n')+'\n| 最后行 | '+'另一列很长正文。'.repeat(120)+' |\n');
        await expect(workspace.locator('tbody tr')).toHaveCount(37);await pause(350);const tall=await page.evaluate(()=>document.documentElement.scrollHeight);
        emit('| '+'左侧很长正文。'.repeat(150)+' | 短 |\n');await expect(workspace.locator('tbody tr')).toHaveCount(38);await pause(350);const short=await page.evaluate(()=>document.documentElement.scrollHeight);assert.ok(short<tall-200,'real table reflow shrinks the followed document');
        emit('\n\n'+Array.from({length:8},(_,i)=>'缩高后新增段'+i+'：'+ '继续保持最新内容可见。'.repeat(20)+'\n\n').join(''));await expect(workspace.locator('.rag-answer')).toContainText('缩高后新增段7');await pause(350);
        const latest=await page.evaluate(()=>({remaining:document.documentElement.scrollHeight-scrollY-innerHeight,composer:document.querySelector('.rag-composer').getBoundingClientRect().top}));assert.ok(latest.remaining<40,'programmatic upward correction cannot stop following subsequent text');assert.ok(latest.composer<await page.evaluate(()=>innerHeight));record(`${label}: following survives table contraction and later output`);
      }
      } finally {if(pending.has(imageTask))finish(imageTask);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);}
    };
    await run('a real delayed image above paused reading preserves its character',()=>imageCase(false));
    await run('a real delayed image above live following keeps the latest answer visible without a text delta',()=>imageCase(true));
    await page.screenshot({path:path.join(root,label+'-settled.png')});
    (report.readingDiagnostics ||= []).push({label,entries:await page.evaluate(()=>window.readingDiagnostics)});
    // Same narrow diagnostic as verify-rag-task-browser: WebKit emits caught
    // fetch cancellation as pageerror during document teardown. Keep all evidence.
    const teardownErrors = pageErrors.filter(error => engine === 'webkit' && /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/study-log\/api\/.*due to access control checks\./.test(error.stack || '') && navigations.some(item => error.at >= item.startedAt && error.at <= (item.endedAt || item.startedAt) + 500));
    (report.navigationTransportDiagnostics ||= []).push(...teardownErrors); (report.navigations ||= []).push({ label, navigations });
    assert.deepEqual(unhandled, []); assert.deepEqual(pageErrors.filter(error => !teardownErrors.includes(error)), []);
    await context.close(); await browser.close(); browser = null;
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), source);
  assert.equal(peak, 1, 'view updates and reconnection never execute another model concurrently');
  assert.equal(report.errors.length, 0, 'all live-follow checks must pass'); report.passed = true;
} catch (error) { report.failure = error.stack; if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error; }
finally {
  if (browser) await browser.close(); if (web) { web.kill(); await once(web, 'exit').catch(() => {}); }
  for (const responses of imageWaiters.values()) for(const res of responses)res.destroy();
  for (const res of pending.values()) res.destroy(); for (const respond of heldTitles.splice(0)) respond();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); await fs.writeFile(path.join(root, 'server.log'), serverLog);
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await mcp.close(); console.log(JSON.stringify({ root, passed: report.passed, checks: report.checks.length }));
}

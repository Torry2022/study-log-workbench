// Adapted from personal 3744917: public instance initialization, MCP API and model configuration.
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
const repo = path.resolve(import.meta.dirname, '..', '..'), root = path.join(repo, '.local', `rag-smooth-output-${Date.now()}`);
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
let streams = 0, active = 0, peak = 0, web, holdTitles = false, legacyPad = '';
const heldTitles = [];
const pending = new Map();
const model = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); report.modelRequests.push({ stream: body.stream === true, model: body.model });
  if (!body.stream) {
    const title = body.messages?.[0]?.content?.includes('短语式标题');
    const respond = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: title ? '合成保存问答' : JSON.stringify({ query: '合成保存', scopeSource: null, strategy: 'relevance' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4 } })); };
    if (title && holdTitles) heldTitles.push(respond); else respond(); return;
  }
  const n = ++streams; active++; peak = Math.max(peak, active); pending.set(n, res);
  res.setHeader('content-type', 'text/event-stream'); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `第${n}次合成回答：先确认内容${legacyPad}` }, finish_reason: null }] })}\n\n`);
  res.once('close', () => { active--; pending.delete(n); });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const finish = n => {
  const res = pending.get(n); assert.ok(res, `model ${n} is waiting`);
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '，再保存。[S1]' }, finish_reason: 'stop' }], usage: { prompt_tokens: 21, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
};
const mcp = await startHttpServer({ host: '127.0.0.1', port: 0, logRoot: data, indexRoot: path.join(instance, 'index'), token: 'synthetic-browser-task-mcp', retrieval: { embedding: { apiKey: '', apiUrl: '', model: '' }, reranker: { apiKey: '', apiUrl: '', model: '' }, rerankEnabled: false } });
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`, require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, webkit, expect } = require('@playwright/test');
const safe = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'Path', 'COMSPEC'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
let serverLog = '', currentPage, browser;
try {
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: path.join(repo, 'study-log-web'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...safe, ...environment, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, 'backups'), NODE_ENV: 'production',
    CHAT_API_URL: `http://127.0.0.1:${model.address().port}/chat`, CHAT_API_KEY: 'synthetic-browser-model-key', CHAT_MODEL: 'synthetic-browser-model', CHAT_LIGHT_MODEL: 'synthetic-browser-model',
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcp.address.port}/mcp`, STUDY_LOG_MCP_TOKEN: 'synthetic-browser-task-mcp', WIKI_JEV_API_KEY: '', WIKI_COMPILE_TOKEN: '', RAG_AGENT_ENABLED: 'false', RAG_AGENT_TOOL_CALLING_VERIFIED: 'false', RAG_JEV_ENABLED: 'false', RAG_STATUS_VERIFICATION_ENABLED: 'false' } });
  web.stdout.on('data', value => serverLog += value); web.stderr.on('data', value => serverLog += value);
  await until(async () => fetch(base).then(r => r.ok).catch(() => false), Boolean);
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    legacyPad='';
    browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: path.join(root, 'videos'), size: { width: 960, height: 600 } } });
    const page = await context.newPage(); currentPage = page;
    const navigations = [], errors = [], unhandled = [];
    const navigate = async url => { const item={start:Date.now(),end:null};navigations.push(item);try{return await(url?page.goto(url):page.reload());}finally{item.end=Date.now();} };
    page.on('pageerror', error=>errors.push({at:Date.now(),stack:error.stack,message:error.message}));
    await page.exposeFunction('captureSmoothUnhandled', value=>unhandled.push(value));
    await page.addInitScript(()=>addEventListener('unhandledrejection',event=>{void window.captureSmoothUnhandled({message:String(event.reason),stack:event.reason?.stack});}));
    await page.addInitScript(() => {
      window.smoothFrames = []; window.captureSmooth = sessionStorage.getItem('captureSmoothOnLoad')==='true';
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.smoothCopied=text;}}});
      const frame = time => {
        if (window.captureSmooth) window.smoothFrames.push({ time, text: [...document.querySelectorAll('.rag-workspace .rag-answer .markdown-preview')].filter(item=>!item.closest('[inert]')).at(-1)?.textContent || '', y: scrollY, generating: Boolean(document.querySelector('.rag-workspace [aria-label="停止生成"]')) });
        requestAnimationFrame(frame);
      }; requestAnimationFrame(frame);
    });
    await navigate(base); await page.getByLabel('访问密码').fill(environment.APP_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('button', { name: '问答', exact: true }).click();
    await page.getByRole('button', { name: '新建问答', exact: true }).filter({ visible: true }).first().click();
    const input = page.getByRole('textbox', { name: '输入知识库问题', exact: true });
    await input.fill('合成保存应如何确认？'); await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await until(() => streams, n => pending.has(n)); const n = streams;
    await expect(page.locator('.rag-answer')).toContainText(`第${n}次合成回答`);
    const burst = '中文内容👩🏽‍💻与家庭👨‍👩‍👧‍👦不会拆分。'.repeat(180);
    const prefix = `第${n}次合成回答：先确认内容`, completeText=prefix+burst+'，再保存。S1';
    await page.evaluate(() => { window.smoothFrames = []; window.captureSmooth = true; });
    pending.get(n).write(`data: ${JSON.stringify({ choices: [{ delta: { content: burst }, finish_reason: null }] })}\n\n`);
    finish(n);
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toHaveCount(0);
    await page.getByRole('button',{name:'复制',exact:true}).last().click();
    assert.ok((await page.evaluate(()=>window.smoothCopied)).includes(burst), 'copy uses the complete authoritative answer, never the presentation prefix');
    await expect(page.locator('.rag-answer .markdown-preview').last()).toHaveText(completeText);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.evaluate(() => { window.captureSmooth = false; });
    const frames = await page.evaluate(() => window.smoothFrames);
    (report.frames ||= []).push({ engine, frames });
    const middle = [...new Set(frames.map(frame => frame.text).filter(text => text.length > prefix.length && text.length < prefix.length + burst.length))];
    assert.ok(middle.length >= 2, `${engine} should visibly reveal a received burst across several frames, got ${middle.length}`);
    const ends = new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(prefix+burst)].map(part=>part.index+part.segment.length));
    for(const text of middle) { assert.equal(text,(prefix+burst).slice(0,text.length)); assert.ok(ends.has(text.length),'every reveal ends on a grapheme boundary'); }
    const finished = frames.find(frame=>!frame.generating), revealed = frames.find(frame=>frame.text===completeText);
    assert.ok(finished&&revealed,'capture the final presentation frame as well as authoritative completion');
    assert.ok(frames.some(frame=>!frame.generating&&frame.text.length>prefix.length&&frame.text.length<prefix.length+burst.length),'authoritative completion is independent of the visible tail');
    assert.ok(revealed.time-finished.time<=400,'completion tail must not become a long typing animation');
    const changes=frames.filter((frame,index)=>frame.text!==frames[index-1]?.text);
    (report.metrics ||= []).push({engine,intermediateCommits:middle.length,markdownCommits:changes.length,completionToFinalPaintMs:revealed.time-finished.time});
    assert.ok(changes.length<=10,'Markdown commits are capped rather than performed at display refresh rate');
    const sessionId = new URL(page.url()).searchParams.get('session');
    const saved = await (await page.request.get(`${base}/api/rag/sessions/${sessionId}`)).json();
    assert.ok(saved.session.messages.at(-1).content.includes(burst));
    report.checks.push(`${engine}: received burst is visibly buffered through completion`);
    const fullText=await page.locator('.rag-answer .markdown-preview').last().textContent();
    await page.evaluate(()=>sessionStorage.setItem('captureSmoothOnLoad','true'));await navigate(); await expect(page.locator('.rag-answer')).toContainText(burst);
    assert.equal(await page.locator('.rag-answer .markdown-preview').last().textContent(),fullText);
    assert.ok((await page.evaluate(()=>window.smoothFrames)).filter(frame=>frame.text).every(frame=>frame.text===fullText),'reopened history must not replay old text');
    await page.evaluate(()=>{sessionStorage.removeItem('captureSmoothOnLoad');window.captureSmooth=false;});
    record(`${engine}: persisted history reopens in full without replay`);

    const fresh=async()=>{await page.getByRole('button',{name:'新建问答',exact:true}).filter({visible:true}).first().click();await expect(page.locator('.rag-workspace .rag-message')).toHaveCount(0);await expect.poll(()=>new URL(page.url()).searchParams.get('session')).toBeNull();};
    let controlledLegacy=false;
    const send=async()=>{const n=streams+1;if(controlledLegacy)streams=n;await input.fill('合成保存的后续确认');await page.getByRole('button',{name:'发送问题',exact:true}).click();if(controlledLegacy){await page.waitForFunction(()=>Boolean(window.syntheticController));await page.evaluate(text=>window.syntheticEmit('delta',{text}),`第${n}次合成回答：先确认内容${legacyPad}`);}else await until(()=>streams,value=>value===n);await expect(page.locator('.rag-answer')).toContainText(`第${n}次合成回答：先确认内容${legacyPad}`);return n;};
    const write=async(n,text)=>controlledLegacy?page.evaluate(text=>window.syntheticEmit('delta',{text}),text):pending.get(n).write(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})}\n\n`);
    const complete=async n=>{if(controlledLegacy)await page.evaluate(()=>{window.syntheticEmit('delta',{text:'，再保存。[S1]'});window.syntheticEmit('done',{answer:window.syntheticAnswer,citations:[]});window.syntheticController.close();window.syntheticController=null;});else finish(n);};
    const capture=()=>page.evaluate(()=>{window.smoothFrames=[];window.captureSmooth=true;});
    const take=()=>page.evaluate(async()=>{await new Promise(requestAnimationFrame);window.captureSmooth=false;return window.smoothFrames;});
    await fresh(); const markdownTask=await send();
    const markdown='\n\n## 长 Markdown\n\n'+Array.from({length:80},(_,i)=>`第${i+1}段：${'中文与👩🏽‍💻完整显示。'.repeat(20)}\n\n`).join('')+'| 项目 | 值 |\n| --- | --- |\n'+Array.from({length:30},(_,i)=>`| 行${i} | ${i} |`).join('\n')+'\n\n```javascript\n'+Array.from({length:40},(_,i)=>`const value${i} = "👨‍👩‍👧‍👦";`).join('\n')+'\n```\n';
    await capture();await write(markdownTask,markdown);finish(markdownTask);
    await expect(page.locator('.rag-answer table tbody tr')).toHaveCount(30);await expect(page.locator('.rag-answer pre code')).toContainText('const value39');
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    await expect(page.locator('.rag-answer pre code')).toContainText('👨‍👩‍👧‍👦');
    await page.screenshot({path:path.join(root,`${engine}-markdown-complete.png`)});
    (report.markdownFrames ||= []).push({engine,frames:await take()});record(`${engine}: long Markdown, table and fenced code finish intact`);

    await fresh();const reducedTask=await send();await capture();await write(reducedTask,burst);
    await until(()=>page.evaluate(()=>window.smoothFrames.some(frame=>frame.text.length>100)),Boolean);
    await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.rag-answer')).toContainText(burst);
    const reducedAt=await page.locator('.rag-answer .markdown-preview').last().textContent();await pause(300);assert.equal(await page.locator('.rag-answer .markdown-preview').last().textContent(),reducedAt);
    finish(reducedTask);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await take();record(`${engine}: reduced motion flushes an active queue immediately`);
    await fresh();const reducedFromStart=await send();await capture();await write(reducedFromStart,burst);finish(reducedFromStart);await expect(page.locator('.rag-answer')).toContainText(burst);
    const reducedFrames=await take(), reducedPrefix=`第${reducedFromStart}次合成回答：先确认内容`;
    (report.reducedFrames ||= []).push({engine,frames:reducedFrames});
    assert.ok(!reducedFrames.some(frame=>frame.text.length>reducedPrefix.length&&frame.text.length<reducedPrefix.length+burst.length));
    record(`${engine}: reduced motion starts without a display backlog`);

    await page.emulateMedia({reducedMotion:'no-preference'});await fresh();const backgroundTask=await send();await write(backgroundTask,burst);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(page.locator('.rag-answer')).toContainText(burst);
    await write(backgroundTask,'后台接收的真实尾段。');await expect(page.locator('.rag-answer')).toContainText('后台接收的真实尾段。');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});finish(backgroundTask);
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);record(`${engine}: synthetic page visibility lifecycle flushes without replaying a backlog`);

    await fresh();const cancelled=await send();await capture();await write(cancelled,burst);
    await until(()=>page.evaluate(()=>window.smoothFrames.some(frame=>frame.text.length>100)),Boolean);
    await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.locator('.rag-message-state.note')).toContainText('生成已停止');
    await expect(page.locator('.rag-answer')).toContainText(burst);await pause(300);
    assert.equal(await page.locator('.rag-message').count(),2);
    await page.locator('.rag-message-state.note').getByRole('button',{name:'重新生成',exact:true}).click();await until(()=>streams,value=>value===cancelled+1);finish(cancelled+1);
    await expect(page.locator('.rag-answer')).toContainText(`第${cancelled+1}次合成回答`);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    assert.ok(!(await page.locator('.rag-answer').textContent()).includes('家庭'));record(`${engine}: cancellation flushes and explicit retry cannot inherit old text`);

    const replaced=streams+1;await page.getByRole('button',{name:'重新生成',exact:true}).last().click();await until(()=>streams,value=>value===replaced);await write(replaced,burst);finish(replaced);
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'上一个回答版本',exact:true}).click();
    await expect(page.locator('.rag-answer')).toContainText(`第${cancelled+1}次合成回答`);await pause(350);assert.ok(!(await page.locator('.rag-answer').textContent()).includes('家庭'));
    await page.getByRole('button',{name:'下一个回答版本',exact:true}).click();await expect(page.locator('.rag-answer')).toContainText(burst);
    record(`${engine}: selecting a replacement version clears the old tail without mixing answers`);

    await fresh();const failed=await send();await capture();await write(failed,burst);
    await until(()=>page.evaluate(()=>window.smoothFrames.some(frame=>frame.text.length>100)),Boolean);
    pending.get(failed).end(`data: ${JSON.stringify({error:{message:'synthetic provider failure'}})}\n\n`);
    await expect(page.locator('.rag-message-state.error')).toBeVisible();await expect(page.locator('.rag-answer')).toContainText(burst);await pause(300);
    assert.equal(await page.locator('.rag-message').count(),2);record(`${engine}: failure settles received text and cancels the display queue`);

    await fresh();const liveReopen=await send();await write(liveReopen,burst);await expect(page.locator('.rag-answer')).toContainText(burst);
    const liveId=new URL(page.url()).searchParams.get('session'), liveText=await page.locator('.rag-answer .markdown-preview').last().textContent();
    await page.evaluate(()=>sessionStorage.setItem('captureSmoothOnLoad','true'));await navigate(`${base}?view=qa&session=${liveId}`);await expect(page.locator('.rag-answer')).toContainText(burst);
    const reopenFrames=await page.evaluate(()=>window.smoothFrames);assert.ok(reopenFrames.filter(frame=>frame.text).every(frame=>frame.text===liveText));
    await page.evaluate(()=>sessionStorage.removeItem('captureSmoothOnLoad'));await capture();const newTail='重开后收到的新分片👩🏽‍💻。'.repeat(180);await write(liveReopen,newTail);finish(liveReopen);
    await expect(page.locator('.rag-answer')).toContainText(newTail);const newFrames=await take();
    assert.ok(newFrames.filter(frame=>frame.text).every(frame=>frame.text.startsWith(liveText)),'reopening never replays or truncates its baseline');
    record(`${engine}: a running task reopens its full snapshot and smooths only later deltas`);

    await fresh();const leaving=await send();await capture();await write(leaving,burst);finish(leaving);
    await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    const leavingId=new URL(page.url()).searchParams.get('session');await fresh();await pause(350);await expect(page.locator('.rag-message')).toHaveCount(0);
    await navigate(`${base}?view=qa&session=${leavingId}`);await expect(page.locator('.rag-answer')).toContainText(burst);
    record(`${engine}: navigation clears a completion tail and reopening shows the saved full answer`);

    await page.route('**/api/capabilities',async route=>{const response=await route.fetch(),value=await response.json();delete value.features.ragTasks;await route.fulfill({response,json:value});});
    // Measure one-character deltas after a settled long paragraph, not during
    // first-response delivery. This also stresses incremental grapheme indexing.
    legacyPad=' 基线内容。'.repeat(1600);
    await navigate(`${base}?view=qa`);await expect(input).toBeEnabled();await fresh();
    // Controlled browser ReadableStream isolates UTF-16 slicing/commit cadence
    // from HTTP buffering. The lifecycle cases above use real persisted SSE.
    await page.evaluate(()=>{
      const original=window.fetch.bind(window);
      window.fetch=(input,init)=>String(input).endsWith('/api/rag/query')?Promise.resolve(new Response(new ReadableStream({start(controller){
        window.syntheticController=controller;window.syntheticAnswer='';
        window.syntheticEmit=(event,value)=>{if(event==='delta')window.syntheticAnswer+=value.text;controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));};
      }}),{headers:{'content-type':'text/event-stream'}})):original(input,init);
    });controlledLegacy=true;
    const legacy=await send();await capture();
    const fine='细'.repeat(40);for(const character of fine){await write(legacy,character);await pause(16);}await complete(legacy);
    await expect(page.locator('.rag-answer')).toContainText(fine);await expect(page.getByRole('button',{name:'停止生成',exact:true})).toHaveCount(0);
    const fineFrames=await take(), fineChanges=fineFrames.filter((frame,index)=>frame.text!==fineFrames[index-1]?.text);
    assert.ok(fineChanges.length>=5,'ongoing fine-grained input must not starve visible commits until completion');
    assert.ok(fineChanges.length<=Math.ceil((fineChanges.at(-1).time-fineChanges[0].time)/50)+3,'high-frequency input cannot force a Markdown commit on every frame');
    (report.fineFrames ||= []).push({engine,frames:fineFrames,commits:fineChanges.length});record(`${engine}: controlled legacy-stream deltas respect the Markdown commit cadence`);

    // Split UTF-16 code units exercise the browser stream directly: SQLite's
    // UTF-8 encoding replaces lone surrogates before a task snapshot reaches UI.
    await expect(input).toBeEnabled();
    await fresh();const splitUnicode=await send();await capture();await write(splitUnicode,'\ud83d');await pause(350);
    const held=await page.locator('.rag-answer .markdown-preview').last().textContent();assert.ok(held.isWellFormed());assert.ok(!held.includes('\ufffd'));
    const validTail='\udc69\u200d\ud83d\udcbb'+burst;await write(splitUnicode,validTail);await complete(splitUnicode);await expect(page.locator('.rag-answer')).toContainText('👩‍💻'+burst);
    const unicodeFrames=await take();assert.ok(unicodeFrames.every(frame=>frame.text.isWellFormed()&&!frame.text.endsWith('\u200d')));
    const unicodePrefix=`第${splitUnicode}次合成回答：先确认内容${legacyPad}`;
    assert.ok(new Set(unicodeFrames.filter(frame=>frame.text.length>unicodePrefix.length&&frame.text.length<unicodePrefix.length+validTail.length+1).map(frame=>frame.text)).size>=2);
    (report.splitUnicodeFrames ||= []).push({engine,frames:unicodeFrames});record(`${engine}: split surrogate and joiner input waits safely then drains new valid content`);

    await expect(input).toBeEnabled();
    await fresh();const joined=await send();await write(joined,'👩');await expect(page.locator('.rag-answer')).toContainText('👩');await write(joined,'\u200d');await pause(120);
    assert.ok((await page.locator('.rag-answer .markdown-preview').last().textContent()).endsWith('👩'),'an incomplete joiner cannot erase an already visible grapheme');
    await write(joined,'💻'+burst);await complete(joined);await expect(page.locator('.rag-answer')).toContainText('👩‍💻'+burst);record(`${engine}: extending a visible emoji with a joiner never erases prior text`);

    controlledLegacy=false;await page.unroute('**/api/capabilities');legacyPad='';await navigate(`${base}?view=qa`);await expect(input).toBeEnabled();
    await fresh();const late=await send();await capture();const firstBurst='较早分片。'.repeat(900);await write(late,firstBurst);
    await page.waitForFunction(()=>{const first=window.smoothFrames.find(frame=>frame.text.length>100);return first&&performance.now()-first.time>=140;});
    const lateTail='结束前才收到的大段真实尾部。'.repeat(700);const lateAt=await page.evaluate(()=>performance.now());await write(late,lateTail);finish(late);
    const latePrefix=`第${late}次合成回答：先确认内容${legacyPad}`+firstBurst;
    const lateExpected=latePrefix+lateTail+'，再保存。S1';
    await expect(page.locator('.rag-answer .markdown-preview').last()).toHaveText(lateExpected);
    await page.waitForFunction(text=>window.smoothFrames.some(frame=>frame.text===text),lateExpected);const lateFrames=await take();
    const tailSteps=[...new Set(lateFrames.filter(frame=>frame.time>=lateAt&&frame.text.length>latePrefix.length&&frame.text.length<latePrefix.length+lateTail.length).map(frame=>frame.text))];
    const lateFinal=lateFrames.find(frame=>frame.text===lateExpected),lateDone=lateFrames.find(frame=>frame.time>=lateAt&&!frame.generating);
    (report.lateTailFrames ||= []).push({engine,frames:lateFrames,lateAt,intermediateCommits:tailSteps.length,sentToFinalPaintMs:lateFinal?.time-lateAt,completionToFinalPaintMs:lateFinal?.time-lateDone?.time});
    assert.ok(lateFinal&&lateDone&&lateFinal.time-lateDone.time<=400,'bound the presentation tail after completion; sender timing also includes server snapshot delivery');
    assert.ok(tailSteps.length>=2,`late completion burst must not be dumped at an earlier chunk deadline; got ${tailSteps.length}`);
    record(`${engine}: a late completion burst retains its own bounded smooth drain`);

    const navigationDiagnostics=errors.filter(error=>engine==='webkit'&&/^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/study-log\/api\/.*due to access control checks\./.test(error.stack||'')&&navigations.some(item=>error.at>=item.start&&error.at<=(item.end||item.start)+500));
    (report.navigationTransportDiagnostics ||= []).push(...navigationDiagnostics);assert.deepEqual(errors.filter(error=>!navigationDiagnostics.includes(error)),[]);assert.deepEqual(unhandled,[]);
    await context.close(); await browser.close(); browser = null;
  }
    assert.equal(await fs.readFile(sourceFile,'utf8'),source);report.passed = true;
} catch (error) { report.failure=error.stack; throw error; }
finally {
  if(browser) await browser.close(); if(web) { const stopped=once(web,'close'); web.kill(); await stopped; }
  for(const res of pending.values()) res.destroy();
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)); await fs.writeFile(path.join(root,'web.log'),serverLog);
  model.closeAllConnections(); await new Promise(resolve=>model.close(resolve)); await mcp.close();
  console.log(JSON.stringify({root,passed:report.passed,checks:report.checks.length}));
}

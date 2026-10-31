import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const [appRoot, output] = process.argv.slice(2);
assert.ok(path.isAbsolute(appRoot) && path.isAbsolute(output));
const { chromium, webkit, expect } = createRequire(path.join(appRoot, 'package.json'))('@playwright/test');
await fs.mkdir(output, { recursive: true });
const data = await fs.mkdtemp(path.join(output, 'synthetic-instance-')); await fs.mkdir(path.join(data, '.backups'), { recursive: true });
await fs.writeFile(path.join(data, '.instance.json'), JSON.stringify({ schemaVersion: 1, id: randomUUID() }));
const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const base = `http://127.0.0.1:${port}/study-log`;
const safe = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC','PLAYWRIGHT_BROWSERS_PATH'].filter(k => process.env[k]).map(k => [k,process.env[k]]));
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)], { cwd: appRoot, windowsHide: true, env: { ...safe,
  LOG_ROOT:data, BACKUP_ROOT:path.join(data,'.backups'), APP_PASSWORD:'synthetic-history-password', SESSION_SECRET:'synthetic-history-session-secret-local-only', COOKIE_SECURE:'false',
  RAG_RUNTIME:'legacy', CHAT_API_KEY:'', DEEPSEEK_API_KEY:'', DASHSCOPE_API_KEY:'', STUDY_LOG_MCP_URL:'http://127.0.0.1:1/mcp' } });
let log='', browser, fixtureSession; app.stdout.on('data',x=>log+=x); app.stderr.on('data',x=>log+=x);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const results=[];
const make = rounds => Array.from({length:rounds},(_,i)=>[{id:`q${i}`,role:'user',content:`第 ${i+1} 轮：回顾这段时间的学习进展`,status:'complete'},
  {id:`a${i}`,role:'assistant',content:`### 第 ${i+1} 轮合成回答\n\n`+Array.from({length:8},(_,j)=>`第${j+1}段：已记录问题、尝试和下一步进展。`).join('\n\n'),status:'complete',citations:[]}]).flat();
try {
  for(let i=0;i<180;i++){try{if((await fetch(base)).status<500)break;}catch{} await sleep(200);}
  for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]) {
    browser=await launcher.launch(); const context=await browser.newContext({viewport:{width:1440,height:900}});
    const login=await context.request.post(`${base}/api/auth/login`,{data:{password:'synthetic-history-password'}}); assert.equal(login.status(),200);
    if(!fixtureSession){const saved=await context.request.post(`${base}/api/rag/sessions`,{data:{id:randomUUID(),mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:make(55)}});
    assert.equal(saved.status(),200,await saved.text()); fixtureSession=(await saved.json()).session;} const session=fixtureSession;
    const page=await context.newPage(), errors=[], reads=[]; page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.url().includes(`/api/rag/sessions/${session.id}`)) reads.push(r.url());});
    await page.goto(`${base}?view=qa&session=${session.id}`);
    await expect(page.locator('[data-rag-message-id]')).toHaveCount(20,{timeout:30000}); await page.evaluate(()=>document.fonts.ready); await sleep(300);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight-scrollY-innerHeight<6),'opens at bottom');
    await expect(page.locator('.qa-history-tick')).toHaveCount(30);
    assert.ok(reads.every(url=>url.includes('history=recent')),'no hidden full history download');
    const last=page.locator('.qa-history-tick').last(); await last.hover(); await expect(page.locator('.qa-history-peek')).toContainText('55');
    const tickBox=await last.boundingBox(),peekBox=await page.locator('.qa-history-peek').boundingBox();
    assert.ok(Math.abs((tickBox.y+tickBox.height/2)-(peekBox.y+peekBox.height/2))<2,'tooltip is beside the hovered tick');
    await page.screenshot({path:path.join(output,`${engine}-tooltip-detail.png`),clip:{x:tickBox.x-4,y:peekBox.y-10,width:Math.min(340,1440-tickBox.x),height:peekBox.height+20}});
    await page.screenshot({path:path.join(output,`${engine}-wide-peek.png`)});
    await page.setViewportSize({width:1440,height:560});await last.hover();await sleep(80);
    const edge=await page.locator('.qa-history-peek').boundingBox();assert.ok(edge.y>=7&&edge.y+edge.height<=553,'tooltip stays within short viewport');
    await page.setViewportSize({width:1440,height:900});await sleep(80);
    // Indexed target is outside the initial batch: one direct, contiguous range read.
    await page.locator('.qa-history-tick').first().click();
    await expect(page.locator('[data-rag-message-id="q20"]')).toHaveCount(1);
    const jumpGap=()=>page.locator('[data-rag-message-id="q25"]').evaluate(node=>{
      const prior=node.previousElementSibling;
      const target=prior?.matches('.rag-time-divider, .rag-time-separator')?prior.querySelector('time'):node.querySelector(':scope > p');
      const bar=document.querySelector('.reader-toolbar-qa');
      return target.getBoundingClientRect().top-bar.getBoundingClientRect().bottom;
    });
    await expect.poll(async()=>Math.abs(await jumpGap()-16),{timeout:4000}).toBeLessThan(1);
    assert.equal(await page.locator('.is-history-located').count(),0,'tick jumps do not frame the message');
    assert.equal(reads.filter(url=>url.includes('around=')).length,1);
    const located=await page.locator('[data-rag-message-id="q25"]').evaluate(node=>({top:node.getBoundingClientRect().top, y:scrollY, headers:[...document.querySelectorAll('.reader-toolbar, .mobile-topbar, .reader-header')].map(h=>({cls:h.className,top:h.getBoundingClientRect().top,bottom:h.getBoundingClientRect().bottom}))}));
    await fs.writeFile(path.join(output,engine+'-geometry.json'),JSON.stringify(located));await page.screenshot({path:path.join(output,engine+'-located.png')});
    await page.locator('[data-rag-message-id="q25"]').evaluate(node=>{
      const date=document.createElement('div');date.dataset.syntheticJumpTime='true';
      date.className='rag-time-separator';
      const time=document.createElement('time');time.textContent='10月24日 19:25';date.append(time);node.before(date);
    });
    await page.locator('.qa-history-tick').first().click();await expect.poll(async()=>Math.abs(await jumpGap()-16),{timeout:4000}).toBeLessThan(1);
    await page.screenshot({path:path.join(output,engine+'-located-time.png')});
    await page.locator('[data-synthetic-jump-time]').evaluate(node=>node.remove());
    assert.equal(await page.locator('.qa-history-tick').count(),30);
    assert.ok((await page.locator('.qa-history-tick').first().getAttribute('aria-label')).includes('26'),'old loaded questions do not replace recent index');
    // Trigger a normal prepend while still reading the first loaded round.
    await page.evaluate(()=>{const node=document.querySelector('[data-rag-message-id="q20"]');scrollTo(0,scrollY+node.getBoundingClientRect().top-180);});
    await page.locator('[data-rag-message-id="q20"]').hover({force:true});await page.mouse.wheel(0,-1);
    await expect(page.locator('[data-rag-message-id="q10"]')).toHaveCount(1);
    await sleep(200);
    const anchorTop=await page.locator('[data-rag-message-id="q20"]').evaluate(node=>node.getBoundingClientRect().top);
    assert.ok(Math.abs(anchorTop-180)<8,`prepend preserves reading anchor: ${anchorTop}`);
    await page.screenshot({path:path.join(output,`${engine}-wide-prepend.png`)});
    await page.getByRole('button',{name:'折叠问答历史',exact:true}).click();await sleep(180);
    await expect(page.locator('.qa-history-rail')).toBeVisible();
    await page.getByRole('button',{name:'展开问答历史',exact:true}).click();await sleep(180);
    await expect(page.locator('.qa-history-rail')).toBeVisible();
    // Invoke the real module handlers without Playwright first scrolling the topbar into view.
    const remembered=await page.evaluate(()=>{const node=[...document.querySelectorAll('[data-rag-message-id]')].find(n=>n.getBoundingClientRect().bottom>80);return {y:scrollY,id:node.dataset.ragMessageId,top:node.getBoundingClientRect().top};});
    await page.getByRole('button',{name:'随记',exact:true}).evaluate(node=>node.click());
    await expect(page.locator('.qa-history-rail')).toBeHidden();
    await page.getByRole('button',{name:'问答',exact:true}).evaluate(node=>node.click());
    await expect(page.locator('.workspace-transition-snapshot')).toHaveCount(0,{timeout:3000});
    await expect.poll(()=>page.evaluate(id=>[...document.querySelectorAll('[data-rag-message-id]')].find(n=>n.dataset.ragMessageId===id)?.getBoundingClientRect().top,remembered.id),{timeout:3000}).toBeCloseTo(remembered.top,0);
    const returned=await page.evaluate(id=>({y:scrollY,top:[...document.querySelectorAll('[data-rag-message-id]')].find(n=>n.dataset.ragMessageId===id)?.getBoundingClientRect().top}),remembered.id);
    await fs.writeFile(path.join(output,engine+'-module.json'),JSON.stringify({remembered,returned}));
    assert.ok(Math.abs(returned.top-remembered.top)<8,'module return preserves reading position: '+JSON.stringify({remembered,returned}));
    // Missing-server optional history API remains backward compatible (full GET still exists).
    const complete=await context.request.get(`${base}/api/rag/sessions/${session.id}`);assert.equal((await complete.json()).session.messages.length,110);
    await page.setViewportSize({width:390,height:844}); await sleep(200);
    await expect(page.locator('.qa-history-rail')).toBeHidden();
    const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(n=>({tag:n.tagName,cls:n.className,right:n.getBoundingClientRect().right}))}));
    await fs.writeFile(path.join(output,engine+'-overflow.json'),JSON.stringify(overflow));
    assert.ok(overflow.scroll<=overflow.width,JSON.stringify(overflow));
    await page.screenshot({path:path.join(output,`${engine}-narrow.png`)});
    assert.deepEqual(errors,[]);results.push({engine,reads,anchorTop,errors});
    await context.close(); await browser.close(); browser=null;
  }
} catch(error){await fs.writeFile(path.join(output,'failure.txt'),error.stack);throw error;}
finally { if(browser)await browser.close();app.kill();await fs.writeFile(path.join(output,'server.log'),log);await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)); }

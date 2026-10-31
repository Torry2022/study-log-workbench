import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [repo,output]=process.argv.slice(2);
const {chromium,webkit,expect}=createRequire(path.join(repo,'study-log-web/package.json'))('@playwright/test');
await fs.mkdir(output,{recursive:true});const results=[];
const full=Array.from({length:55},(_,i)=>[{id:`q${i}`,role:'user',content:`第${i+1}轮：这一周的学习进展如何？`,...(i===25?{timeLabel:'10月24日 19:25'}:{})},
 {id:`a${i}`,role:'assistant',content:`### 第${i+1}轮合成回答\n\n`+'整理遇到的问题、尝试的方法和接下来要做的事。\n\n'.repeat(9),status:'complete'}]).flat();
const outline=full.filter(m=>m.role==='user').slice(-30).map(m=>({questionId:m.id,question:m.content,preview:'合成回答摘要，仅使用已有内容。'}));
for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await launcher.launch();try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(repo,'study-log-harmony/entry/src/main/resources/rawfile/markdown/index.html')).href);
  await page.evaluate(()=>window.readerFrames={activeHeading(){},rendered(){},failed(){},bottomInsetReady(){},qaFollowStopped(){},qaFollowResumed(){}});
  const render=async(start,loading=false)=>page.evaluate(async({start,loading,full,outline})=>{
   window.setQaHistory(JSON.stringify({window:{paginated:true,start,end:110,total:110,firstQuestionId:`q${start/2}`,outline},key:'synthetic-history',loading,error:'',hover:true}));
   const args=window.renderMarkdown.toString().includes('origin')?['','synthetic-history',false]:['synthetic-history',false];
   await window.renderMarkdown(JSON.stringify(full.slice(start)),'','light','qa',...args);
  },{start,loading,full,outline});
  await render(90);await page.evaluate(async()=>{window.setReaderBottomInset(130,1);await document.fonts.ready;window.resumeQaFollow(false);window.qaHistoryReady();});
  await expect(page.locator('[data-rag-message-id]')).toHaveCount(20);await expect(page.locator('.qa-history-tick')).toHaveCount(30);
  await page.locator('.qa-history-tick').last().hover();await expect(page.locator('.qa-history-peek')).toContainText('55');
  const tickBox=await page.locator('.qa-history-tick').last().boundingBox(),peekBox=await page.locator('.qa-history-peek').boundingBox();
  assert.ok(Math.abs(tickBox.y+tickBox.height/2-peekBox.y-peekBox.height/2)<2,'native tooltip is beside hovered tick');
  const originalTick=await page.locator('.qa-history-tick').last().evaluate(node=>{window.originalTick=node;return node.tabIndex;});assert.equal(originalTick,-1);await render(90);
  assert.equal(await page.evaluate(()=>window.originalTick===document.querySelector('.qa-history-tick:last-of-type')),true,'live rerender retains tick nodes');
  await page.screenshot({path:path.join(output,`${engine}-wide.png`)});
  await page.locator('.qa-history-tick').first().click();await render(40);
  await expect.poll(()=>page.locator('[data-rag-message-id="q25"] > .qa-message-time').evaluate(n=>Math.abs(n.getBoundingClientRect().top-16)),{timeout:4000}).toBeLessThan(1);
  assert.equal(await page.locator('.is-history-located').count(),0,'tick jumps do not frame the message');
  await page.screenshot({path:path.join(output,`${engine}-located-time.png`)});
  await page.locator('.qa-history-tick').nth(1).click();
  await expect.poll(()=>page.locator('[data-rag-message-id="q26"] > p').evaluate(n=>Math.abs(n.getBoundingClientRect().top-16)),{timeout:4000}).toBeLessThan(1);
  await page.screenshot({path:path.join(output,`${engine}-located-bubble.png`)});
  assert.equal(await page.locator('.qa-history-tick').count(),30);
  await page.evaluate(()=>{const n=document.querySelector('[data-rag-message-id="q21"]');scrollTo({top:scrollY+n.getBoundingClientRect().top-180,behavior:'instant'});});
  await page.locator('[data-rag-message-id="q21"]').hover({force:true});await page.mouse.wheel(0,-1);
  await page.waitForTimeout(60);await render(40,true);await render(20);
  await page.waitForTimeout(120);const top=await page.locator('[data-rag-message-id="q21"]').evaluate(n=>n.getBoundingClientRect().top);
  assert.ok(Math.abs(top-180)<8,`native renderer prepend anchor: ${top}`);
  await page.screenshot({path:path.join(output,`${engine}-prepend.png`)});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.setQaHistory(JSON.stringify({key:'synthetic-history',hover:false})));
  await expect(page.locator('.qa-history-rail')).toBeHidden();assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`${engine}-narrow.png`)});assert.deepEqual(errors,[]);results.push({engine,anchorTop:top,errors});
 }finally{await browser.close();}
}
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserScope } from './browser-scope.mjs';

test('citations disclose, locate and keep source navigation inside the matching answer', async () => {
 const browser=await createBrowserScope();
 try {
  for(const width of [390,1024]) for(const motion of ['reduce','no-preference']) {
   const page=await browser.newPage({viewport:{width,height:700},reducedMotion:motion});
   await page.goto(new URL('../../entry/src/main/resources/rawfile/markdown/index.html',import.meta.url).href);
   await page.evaluate(async()=>{
    window.readerFrames={bottomInsetReady:()=>{},qaLayoutChange:()=>{}};
    window.payload=[{id:'q',role:'user',content:'合成问题'},{id:'a',role:'assistant',status:'complete',content:'引用 {{study-log-citation:S4|2026-01-04|0|topic}}\n\n'+Array.from({length:30},(_,i)=>`合成段落${i}：内容用于检查滚动。`).join('\n\n'),citations:Array.from({length:5},(_,i)=>({sourceId:`S${i+1}`,date:`2026-01-0${i+1}`,heading:'topic',excerpt:'合成原文'})),versions:['v1','v2'],versionIndex:0}];
    await window.renderMarkdown(JSON.stringify(window.payload),'','light','qa');
   });
   const rows=page.locator('.qa-sources details');assert.equal(await rows.count(),5);assert.equal(await rows.filter({visible:true}).count(),3);
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.locator('.qa-sources-toggle').click();assert.equal(await rows.filter({visible:true}).count(),5);await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY)<4);
   await page.locator('.qa-sources-toggle').click();assert.equal(await rows.filter({visible:true}).count(),3);
   await page.locator('[data-citation-link]').click();await page.waitForFunction(()=>document.querySelector('[data-source-id="S4"].qa-source-highlight'));
   assert.equal(await rows.nth(3).isVisible(),true);await page.waitForTimeout(1100);const rect=await rows.nth(3).locator('summary').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=700,JSON.stringify(rect));assert.equal(await rows.nth(3).getAttribute('open'),null);
   await rows.nth(3).locator('summary').click();assert.match(await rows.nth(3).locator('.qa-source-detail a').getAttribute('href'),/^study-log:\/\/citation\?/);
   assert.equal(await page.locator('.qa-version-count').innerText(),'1 / 2');
   assert.match(await page.getByLabel('下一个回答版本').getAttribute('href'),/action=version.*target=v2/);
   await page.evaluate(()=>window.renderMarkdown(JSON.stringify(window.payload),'','light','qa'));assert.equal(await page.locator('.qa-sources details').nth(3).isVisible(),true);
   await page.evaluate(()=>{ window.payload[1]={...window.payload[1],id:'a2',versionIndex:1};return window.renderMarkdown(JSON.stringify(window.payload),'','light','qa') });
   assert.equal(await page.locator('.qa-version-count').innerText(),'2 / 2');assert.equal(await page.locator('.qa-sources details').filter({visible:true}).count(),3);
   await page.close();
  }
 } finally { await browser.close(); }
});

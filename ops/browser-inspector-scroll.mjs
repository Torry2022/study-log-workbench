import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url));
const {chromium,webkit,expect}=require('@playwright/test');
const [base,output]=process.argv.slice(2);
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname)&&path.isAbsolute(output));
await fs.mkdir(output,{recursive:true});const results=[];
for(const[engine,launcher]of Object.entries({chromium,webkit})){
 const browser=await launcher.launch();
 try{for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1440,height:700},colorScheme:theme});
  await page.goto(`${base}?date=2024-02-10`);await page.getByLabel('访问密码').fill('synthetic-loading-password');await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.locator('.markdown-preview')).toContainText('二月后一篇正文');
  await page.getByRole('button',{name:'AI生成',exact:true}).filter({visible:true}).click();
  for (const width of [1181,1280,1440,1920]) {
   await page.setViewportSize({width,height:700});
   for (const mode of ['浏览','源码','分屏']) {
    await page.locator('.reader-toolbar-log').getByRole('button',{name:mode,exact:true}).click();
    await expect.poll(() => page.evaluate(() => Math.abs(document.querySelector('.reader-toolbar-container:has(.reader-toolbar-log)').getBoundingClientRect().bottom - document.querySelector('.writing-inspector-heading').getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
   }
  }
  await page.setViewportSize({width:1440,height:700});
  await page.locator('.reader-toolbar-log').getByRole('button',{name:'浏览',exact:true}).click();
  const expandedHeight=await page.locator('.reader-toolbar-container:has(.reader-toolbar-log)').evaluate(element=>element.getBoundingClientRect().height);
  await page.getByRole('button',{name:'折叠右侧栏',exact:true}).click();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  assert.equal(await page.locator('.reader-toolbar-container:has(.reader-toolbar-log)').evaluate(element=>element.getBoundingClientRect().height),expandedHeight,'Collapse moved log toolbar');
  await page.getByRole('button',{name:'AI生成',exact:true}).filter({visible:true}).click();
  for(const tab of ['AI生成','重点标注']){
   await page.getByRole('group',{name:'AI 工具类型'}).getByRole('button',{name:tab,exact:true}).click();
   const panel=page.locator('.writing-inspector :is(.writing-panel, .highlight-panel)');
   // Deterministic overflow without a model request; both actual panel containers remain in use.
   await panel.evaluate(element=>{const spacer=document.createElement('div');spacer.dataset.syntheticScroll='true';spacer.style.cssText='flex:none;height:1000px';element.append(spacer);});
   await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
   await page.evaluate(()=>window.scrollTo(0,300));
   await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
   await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
   await expect.poll(() => page.evaluate(() => Math.abs(document.querySelector('.reader-toolbar-container:has(.reader-toolbar-log)').getBoundingClientRect().bottom - document.querySelector('.writing-inspector-heading').getBoundingClientRect().bottom))).toBeLessThanOrEqual(1);
   const box=await panel.boundingBox();await page.mouse.move(box.x+box.width/2,Math.max(100,Math.min(550,box.y+100)));
   assert.ok(await panel.evaluate((element, point) => element.contains(document.elementFromPoint(point.x,point.y)), {x:box.x+box.width/2,y:Math.max(100,Math.min(550,box.y+100))}), 'Pointer must hit actual inspector');
   for(const end of ['top','bottom']){
    await panel.evaluate((element,end)=>element.scrollTop=end==='top'?0:element.scrollHeight,end);
    const before=await page.evaluate(()=>window.scrollY);
    await page.mouse.wheel(0,end==='top'?-600:600);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>window.scrollY),before,`${engine} ${theme} ${tab} ${end} chained to reader`);
    results.push({engine,theme,tab,end,pageScrollUnchanged:true});
   }
   await panel.evaluate(element=>element.scrollTop=0);await page.mouse.wheel(0,200);
   await expect.poll(()=>panel.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
   await page.screenshot({path:path.join(output,`${engine}-${theme}-${tab}.png`)});
  }
  // Outside the inspector, the original page scrolling must still work.
  await page.mouse.move(600,400);const before=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,200);
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
  await page.close();
 }}finally{await browser.close();}
}
await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({checks:results.length,readerScroll:true}));

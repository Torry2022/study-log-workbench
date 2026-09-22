import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import{parseEnv}from'node:util';import{createRequire}from'node:module';
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url));const{chromium,expect}=require('@playwright/test');
const[root,base='http://127.0.0.1:3561/study-log']=process.argv.slice(2);if(!root||!path.isAbsolute(root)||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture required');
const env=parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'));const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.route('**/api/logs/day?date=2026-01-15',async route=>{const response=await route.fetch();const body=await response.json();body.day.content+='\n\n![坏图](assets/broken.png)\n\n```mermaid\ninvalid nonsense\n```\n';await route.fulfill({response,json:body});});
 const login=async()=>{await page.getByLabel('访问密码').fill(env.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.markdown-preview')).toContainText('同名小节',{timeout:60000});};
 const expire=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('study-log:auth-expired')));await expect(page.getByRole('button',{name:'登录',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');assert.equal(await page.getByRole('button',{name:'登录',exact:true}).evaluate(el=>!!el.closest('[inert]')),false);await login();};
 await page.goto(base+'?date=2026-01-15');await login();
 const heading=page.locator('.preview-outline').getByRole('button',{name:'2. 同名小节',exact:true}).last();
 await heading.click();const top=await page.evaluate(()=>scrollY);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await heading.click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(top-30);
 const bad=page.getByRole('img',{name:'坏图',exact:true});await bad.scrollIntoViewIfNeeded();await expect.poll(()=>bad.evaluate(i=>i.complete)).toBe(true);await bad.click();await expect(page.getByRole('dialog',{name:'图片预览'})).toHaveCount(0);
 await expect(page.locator('pre.code-block').filter({hasText:'invalid nonsense'})).toBeVisible();
 const image=page.getByRole('img',{name:'合成示意图',exact:true});await image.click();await expect(page.getByRole('dialog',{name:'图片预览'})).toBeVisible();await page.locator('.image-lightbox-stage').hover();await page.mouse.wheel(0,-120);await expect(page.locator('.image-lightbox-scale')).not.toHaveText('100%');await expire();await expect(page.getByRole('dialog',{name:'图片预览'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.getByRole('button',{name:'更多日志操作',exact:true}).click();await page.getByRole('button',{name:'打开日志大纲',exact:true}).filter({visible:true}).click();await expect(page.getByRole('dialog',{name:'当前日志大纲'})).toBeVisible();await expire();await expect(page.getByRole('dialog',{name:'当前日志大纲'})).toHaveCount(0);
 await page.getByRole('button',{name:'打开日志导航',exact:true}).click();await expire();await expect(page.getByRole('dialog',{name:'日志导航'})).toBeHidden();
 console.log('Passed: repeated heading jump, corrupt image, malformed Mermaid fallback, lightbox zoom, expired session releases all modal layers');
}finally{await browser.close();}

import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../study-log-web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const [root, base='http://127.0.0.1:3561/study-log'] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Explicit local fixture required');
const env=parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'));
const output=path.resolve('artifacts/reader'); await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 for(const [name,width,height,theme] of [['desktop',1440,900,'light'],['mobile',390,844,'dark']]) {
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?date=2026-01-15');
  await page.getByLabel('访问密码').fill(env.APP_PASSWORD); await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.locator('.markdown-preview')).toContainText('同名小节',{timeout:60000});
  await expect(page.locator('.mermaid-block svg')).toBeVisible({timeout:60000});
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(output,name+'.png')});
  const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,dateFont:getComputedStyle(document.querySelector(innerWidth<1024?'.mobile-log-identity strong':'.reader-log-identity h2')).fontFamily,codeFont:getComputedStyle(document.querySelector('.code-block')).fontFamily,fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)}));
  assert.ok(metrics.width<=width,JSON.stringify(metrics));
  if(width<1024){
   assert.match(metrics.dateFont,/Study Log Latin Serif/);assert.ok(metrics.fonts.includes('Study Log Latin Serif'));
   await page.getByRole('button',{name:'打开日志导航',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'日志导航'})).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(page.getByRole('button',{name:'打开日志导航',exact:true})).toBeFocused();
   await page.getByRole('button',{name:'更多日志操作',exact:true}).click();await page.getByRole('button',{name:'打开日志大纲',exact:true}).filter({visible:true}).click();
   await expect(page.getByRole('dialog',{name:'当前日志大纲'})).toBeVisible();
   await page.getByRole('dialog',{name:'当前日志大纲'}).getByRole('button',{name:'2. 同名小节',exact:true}).last().click();
  }else{
   await page.getByRole('button',{name:'折叠左侧栏',exact:true}).click();
   await page.getByRole('button',{name:'展开左侧栏',exact:true}).click();
   await page.locator('.preview-outline').getByRole('button',{name:'2. 同名小节',exact:true}).last().click();
  }
  await expect(page).toHaveURL(/heading=2/);
  if(width<1024)await page.getByRole('button',{name:'更多日志操作',exact:true}).click();await page.getByRole('button',{name:'进入阅读模式',exact:true}).filter({visible:true}).click();
  await expect(page.locator('main')).toHaveClass(/reading-mode/);
  await page.getByRole('button',{name:'退出阅读',exact:true}).click();
  const image=page.getByRole('img',{name:'合成示意图',exact:true});
  await expect(image).toHaveCount(1);{await image.click();await expect(page.getByRole('dialog',{name:'图片预览'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'图片预览'})).toHaveCount(0);}
  const link=page.getByRole('link',{name:'查看二月记录',exact:true});
  await link.scrollIntoViewIfNeeded(); const priorScroll=await page.evaluate(()=>scrollY); await link.click();
  await expect(page.locator('.markdown-preview')).toContainText('并发控制');
  await expect(page).toHaveURL(/date=2026-02-05/);
  await page.goBack(); await expect(page.locator('.markdown-preview')).toContainText('同名小节');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(Math.max(0,priorScroll-100));
  await page.reload();await expect(page.locator('.markdown-preview')).toContainText('同名小节');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({name,metrics,navigation:'passed',reading:'passed'}));await context.close();
 }
}finally{await browser.close();}

import fs from 'node:fs/promises';import path from 'node:path';import{parseEnv}from'node:util';import{createRequire}from'node:module';
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url));const{chromium,expect}=require('@playwright/test');
const[root,base='http://127.0.0.1:3561/study-log']=process.argv.slice(2);if(!root||!path.isAbsolute(root)||!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixture required');
const env=parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'));const browser=await chromium.launch();
try{for(const width of[1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}});await page.goto(base+'?date=2026-01-15');await page.getByLabel('访问密码').fill(env.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.markdown-preview')).toContainText('同名小节',{timeout:60000});
 if(width===1440)await page.getByRole('button',{name:'折叠左侧栏'}).click();
 await page.keyboard.press('Control+g');const calendar=page.getByRole('dialog',{name:'跳转到指定日期'});await expect(calendar).toBeVisible();
 await expect(calendar.getByRole('button',{name:'跳转到 2026-01-15',exact:true})).toBeVisible();await expect(calendar.getByRole('button',{name:'跳转到 2026-01-16',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(page.getByRole('button',{name:'按日期跳转',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'按日期跳转',exact:true}).click();await calendar.getByRole('button',{name:'下一个月',exact:true}).click();await calendar.getByRole('button',{name:'跳转到 2026-02-05',exact:true}).click();await expect(page.locator('.markdown-preview')).toContainText('跨月合成资料');
 if(width===390)await expect(page.getByRole('dialog',{name:'日志导航'})).toBeHidden();
 await page.keyboard.press('Control+g');await expect(calendar).toBeVisible();
 let fail=true;await page.route('**/api/logs?month=2026-01',route=>fail?route.fulfill({status:503,json:{error:'合成日历故障'}}):route.continue());
 await calendar.getByRole('button',{name:'上一个月',exact:true}).click();await expect(calendar.getByRole('alert')).toContainText('合成日历故障');await expect(calendar.locator('button.date-jump-day')).toHaveCount(0);fail=false;await calendar.getByRole('button',{name:'重试读取日期'}).click();await expect(calendar.getByRole('button',{name:'跳转到 2026-01-17',exact:true})).toBeVisible();
 await page.screenshot({path:path.resolve(`artifacts/reader/calendar-${width}.png`)});await page.close();console.log('Calendar passed: '+width);
}}finally{await browser.close();}

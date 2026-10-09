import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {workspacePage} from './workspace-test.mjs';
const require=createRequire(new URL('../../study-log-web/package.json',import.meta.url));const er=createRequire(new URL('./package.json',import.meta.url));const {_electron:electron,expect}=require('@playwright/test');
const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:await fs.mkdtemp(path.join(os.tmpdir(),'sidebar-heading-'))};delete env.ELECTRON_RUN_AS_NODE;
const evidence=path.resolve('.local',`sidebar-heading-${Date.now()}`);await fs.mkdir(evidence);
const app=await electron.launch({executablePath:process.argv[2]||er('electron'),args:process.argv[2]?[]:[path.resolve('ops/electron')],env});const rows=[],failures=[];
try{const page=await workspacePage(app);
for(const width of [1600,1400,1230,1100,1050]){await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,780),width);
for(const [name,view] of [['统计','stats'],['收藏','favorites'],['随记','notes']]){await page.locator('.topbar-actions').getByRole('button',{name,exact:true}).click();await expect(page.locator(`.app-shell.view-${view}`)).toBeVisible();await page.waitForTimeout(220);
const m=await page.locator('.sidebar-filter-heading').evaluate(e=>{const title=e.querySelector('.section-title'),text=title.querySelector('span')||title,range=document.createRange();range.selectNodeContents(text);const r=range.getBoundingClientRect(),s=getComputedStyle(title),a=e.getBoundingClientRect(),buttons=e.querySelector('.sidebar-filter-heading-actions').getBoundingClientRect();return {title:text.textContent,lines:[...range.getClientRects()].filter(r=>r.width>0).map(r=>({top:r.top,height:r.height})),textHeight:r.height,lineHeight:parseFloat(s.lineHeight),left:range.getBoundingClientRect().left,right:r.right,buttonsLeft:buttons.left,headingRight:a.right,buttonsRight:buttons.right};});rows.push({width,view,...m});if(new Set(m.lines.map(r=>r.top)).size!==1||m.textHeight>m.lineHeight*1.5||m.right>m.buttonsLeft+1||m.buttonsRight>m.headingRight+1)failures.push(rows.at(-1));
await page.screenshot({path:path.join(evidence,`${width}-${view}.png`)});
}}
await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({rows,failures},null,2));console.log(evidence);assert.deepEqual(failures,[]);
}finally{if(app.process().exitCode===null){const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({BrowserWindow,dialog})=>{dialog.showMessageBoxSync=()=>1;BrowserWindow.getAllWindows().reverse().forEach(w=>w.close());});await closed;}}

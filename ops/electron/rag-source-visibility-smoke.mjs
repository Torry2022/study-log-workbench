import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { initialize } from '../instance.mjs';
import { createRagSession } from '../../study-log-web/lib/rag-sessions-store.ts';
import { workspacePage } from './workspace-test.mjs';
assert.ok(process.argv[2] && process.argv[3], 'Pass isolated packaged EXE and new evidence directory');
const root=path.resolve(process.argv[3]), instance=path.join(root,'instance'),profile=path.join(root,'profile');
const exe=path.resolve(process.argv[2]);
await fs.mkdir(root,{recursive:true});await initialize(instance);await fs.mkdir(profile);await fs.writeFile(path.join(profile,'desktop.json'),JSON.stringify({mode:'local',usageConfirmed:true,root:instance}));
const file='2026-09_学习日志.md';await fs.writeFile(path.join(instance,'data',file),'## 2026-09-01\n\n'+Array.from({length:5},(_,i)=>`### ${i+1}. 合成主题${i+1}\n\n合成内容${i+1}。\n`).join('\n'));
process.env.LOG_ROOT=path.join(instance,'data'); process.env.BACKUP_ROOT=path.join(instance,'backups');
const citations=Array.from({length:5},(_,i)=>({sourceId:`S${i+1}`,date:'2026-09-01',month:'2026-09',fileName:file,heading:`${i+1}. 合成主题${i+1}`,headingIndex:i,chunkId:`fixture-${i}`,contentHash:'fixture-hash',excerpt:`合成内容${i+1}`}));
const session=await createRagSession({id:randomUUID(),mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:randomUUID(),role:'user',content:'合成问题',status:'complete'},{id:randomUUID(),role:'assistant',content:'这是合成回答。[S1] [S2] [S3] [S4] [S5]\n\n'+Array.from({length:20},(_,i)=>`第${i+1}段合成记录。`).join('\n\n'),status:'complete',citations}]});
const { _electron:electron,expect }=createRequire(new URL('../../study-log-web/package.json',import.meta.url))('@playwright/test'); const env={...process.env,STUDY_LOG_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const report={checks:[],screenshots:[],errors:[],paidCalls:0,installed:false};
try {
 app=await electron.launch({executablePath:exe,args:[],env,timeout:60000});page=await workspacePage(app);page.on('pageerror',e=>report.errors.push(e.message));const base=new URL(page.url()).origin+'/study-log';
 for(const [label,width,height] of [['narrow',820,800],['wide',1440,900]]) {
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
  await page.goto(`${base}?view=qa&session=${session.id}`);await expect(page.locator('.rag-answer')).toContainText('这是合成回答');
  const answer=page.locator('.rag-message-assistant').last(),sources=answer.locator('.rag-citations'),toggle=sources.locator('.rag-list-toggle');
  await expect(sources.locator('.rag-citation-entry')).toHaveCount(3);await sources.scrollIntoViewIfNeeded();
  let file=path.join(root,`${label}-collapsed.png`);await page.screenshot({path:file});report.screenshots.push(file);
  await toggle.click();await expect(sources.locator('.rag-citation-entry')).toHaveCount(5);await page.waitForTimeout(350);
  file=path.join(root,`${label}-expanded.png`);await page.screenshot({path:file});report.screenshots.push(file);
  await toggle.click();await expect(sources.locator('.rag-citation-entry')).toHaveCount(3);await answer.locator('.markdown-preview').getByText('S5',{exact:true}).first().click();
  await expect(sources.locator('[data-rag-source="S5"]')).toHaveClass(/is-located/);file=path.join(root,`${label}-located.png`);await page.screenshot({path:file});report.screenshots.push(file);
  const row=sources.locator('[data-rag-source=\"S5\"] .rag-citation');
  const hit=await row.evaluate(el=>{const r=el.getBoundingClientRect(),t=document.elementFromPoint(r.right-20,r.top+r.height/2);return !!t?.closest('[data-rag-source=\"S5\"]');});assert.equal(hit,true,`${label}: source arrow must receive pointer`);
  if(label==='narrow') {
    const floating=page.locator('.back-to-top-control');await floating.evaluate(el=>{el.style.setProperty('top','56px','important');el.style.setProperty('bottom','auto','important')});
    const before=await page.evaluate(()=>scrollY);await answer.locator('.markdown-preview').getByText('S5',{exact:true}).first().evaluate(el=>el.click());await page.waitForTimeout(450);
    assert.ok(Math.abs((await page.evaluate(()=>scrollY))-before)<3,'unrelated top floating control must not move already-visible source');
    await floating.evaluate(el=>{el.style.removeProperty('top');el.style.removeProperty('bottom')});
  }
  await row.click({position:{x:(await row.boundingBox()).width-20,y:(await row.boundingBox()).height/2}});await expect(sources.locator('[data-rag-source=\"S5\"] .rag-citation-detail')).toBeVisible();await row.click();
  const visible=await toggle.evaluate(el=>{const r=el.getBoundingClientRect(),dock=document.querySelector('.rag-composer-slot:not(.is-hidden)')?.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {top:r.top,bottom:r.bottom,limit:dock?.top??innerHeight,hit:hit===el||el.contains(hit)};});assert.ok(visible.top>=0&&visible.bottom<=visible.limit&&visible.hit,`${label}: collapse control must be fully visible and clickable: ${JSON.stringify(visible)}`);
  await toggle.click();await expect(sources.locator('.rag-citation-entry')).toHaveCount(3);
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  const backBottom=page.getByRole('button',{name:'回到底部'});await expect(backBottom).toBeVisible();await backBottom.click();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(8);
  const backTop=page.getByRole('button',{name:/返回顶部，当前滚动进度/});await expect(backTop).toBeVisible();await backTop.click();await expect.poll(()=>page.evaluate(()=>scrollY)).toBeLessThan(2);
  await expect(backBottom).toBeVisible();await backBottom.click();await page.waitForTimeout(450);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY)).toBeLessThan(5);
  const input=page.getByRole('textbox',{name:'输入知识库问题',exact:true});await input.click();await input.fill('合成输入，无发送');await expect(input).toBeFocused();await expect(input).toHaveValue('合成输入，无发送');await input.fill('');report.checks.push(`${label}: collapse expand locate; composer click and input`);
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
} catch(e){report.failure=e.stack;await page?.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});process.exitCode=1;} finally {if(app){const closed=app.waitForEvent('close',{timeout:60000});await app.evaluate(({app})=>app.quit()).catch(()=>{});await closed.catch(()=>{});}await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}

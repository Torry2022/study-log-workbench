// Adapted from personal 82a4ee8; public instance, split CSS, no Wiki or real data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { initialize } from './instance.mjs';
import { buildMarkdownOutline } from '../study-log-web/lib/markdown-outline.ts';
import { addFavorite, createFavoriteGroup, updateFavoriteGroups } from '../study-log-web/lib/favorites-store.ts';
import { createStudyNote } from '../study-log-web/lib/notes-store.ts';
import { createRagSession } from '../study-log-web/lib/rag-sessions-store.ts';
const repo=path.resolve(import.meta.dirname,'..'), root=path.join(repo,'.local',`sidebar-typography-${Date.now()}`), instance=path.join(root,'instance');
await fs.mkdir(root,{recursive:true}); await initialize(instance);
const env=parseEnv(await fs.readFile(path.join(instance,'.env'),'utf8'));
process.env.LOG_ROOT=path.join(instance,'data'); process.env.BACKUP_ROOT=path.join(instance,'backups');
const source='## 2026-09-01\n\n### 合成侧栏\n\n合成学习记录。\n';
await fs.writeFile(path.join(process.env.LOG_ROOT,'2026-09_学习日志.md'),source);
const heading=buildMarkdownOutline(source).find(h=>h.level===3);
const favorite=await addFavorite({date:'2026-09-01',headingText:heading.text,headingId:heading.id,level:3});
const group=await createFavoriteGroup('用于核对换行与菜单位置的较长收藏分组名称'); await updateFavoriteGroups(favorite.id,[group.id]);
await createStudyNote({body:'侧栏合成随记',recordedAt:'2026-09-01T12:00',tags:['学习方法','工程实践']});
await createRagSession({id:randomUUID(),mutationId:randomUUID(),baseVersion:null,answerMode:'logs_only',messages:[{id:'q',role:'user',content:'合成侧栏问题'},{id:'a',role:'assistant',content:'合成侧栏回答'}]});
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}/study-log`,require=createRequire(new URL('../study-log-web/package.json',import.meta.url)),{chromium,webkit,expect}=require('@playwright/test');
const safe=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(k)));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:path.join(repo,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,...env,NODE_ENV:'production',LOG_ROOT:process.env.LOG_ROOT,BACKUP_ROOT:process.env.BACKUP_ROOT,CHAT_API_URL:'',CHAT_API_KEY:'',CHAT_MODEL:'',STUDY_LOG_MCP_URL:'',STUDY_LOG_MCP_TOKEN:''}});
let log='';server.stdout.on('data',v=>log+=v);server.stderr.on('data',v=>log+=v);const checks=[];
try {
 await expect.poll(()=>fetch(base).then(r=>r.ok).catch(()=>false),{timeout:30000}).toBe(true);
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await launcher.launch();try {
   for(const [width,theme] of [[1440,'light'],[1440,'dark'],[390,'light'],[320,'dark']]) {
    const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,reducedMotion:'reduce'});
    await page.addInitScript(t=>localStorage.setItem('study-log-theme',t),theme);
    await page.goto(base);await page.getByLabel('访问密码').fill(env.APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.workspace')).toBeVisible();
    for(const [view,selector,size,opener] of [['log','.nav-item',16,'打开日志导航'],['favorites','.favorite-navigation-list .favorite-filter-chip',16,'打开收藏筛选'],['notes','.notes-sidebar-content .nav-item',16,'打开随记筛选'],['qa','.rag-session-main span',14,'打开问答历史'],['stats','.nav-item',16,'打开统计导航']]) {
     await page.goto(`${base}?view=${view}`);if(width<768)await page.getByLabel(opener,{exact:true}).click();
     const sidebar=page.locator('.sidebar'),item=sidebar.locator(selector).first();await expect(item).toBeVisible();
     const style=await item.evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,weight:s.fontWeight}});
     assert.equal(style.size,`${size}px`);assert.equal(style.weight,'400');assert.equal(await sidebar.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
     if(view==='favorites') {await expect(sidebar.locator('.favorite-navigation-groups .section-title svg')).toHaveCount(1);await expect(sidebar.getByRole('button',{name:'管理分组',exact:false}).first()).toBeVisible();}
     await sidebar.screenshot({path:path.join(root,`${engine}-${width}-${theme}-${view}.png`)});checks.push({engine,width,theme,view,...style});
    }await page.close();
   }
  }finally{await browser.close();}
 }
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify({checks,paidModelCalls:0},null,2));console.log(JSON.stringify({root,checks:checks.length}));
}finally {server.kill();await fs.writeFile(path.join(root,'server.log'),log);}


import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const repository=path.resolve(import.meta.dirname,'..'), evidence=path.join(repository,'.local',`log-loading-${Date.now()}`);
const root=path.join(evidence,'synthetic-data'),backups=path.join(evidence,'synthetic-backups');
await fs.mkdir(root,{recursive:true}); await fs.mkdir(backups);
const sources={ '2024-02_学习日志.md':'## 2024-02-09\n\n### 1. 二月前一篇\n\n二月前一篇正文\n\n---\n\n## 2024-02-10\n\n### 1. 二月后一篇\n\n二月后一篇正文\n\n---\n', '2024-01_学习日志.md':'## 2024-01-08\n\n没有标题的普通正文\n\n---\n'};
sources['2024-02_学习日志.md'] = sources['2024-02_学习日志.md'].replace('二月后一篇正文', '二月后一篇正文\n\n' + '合成滚动段落。\n\n'.repeat(120));
for(const [name,text]of Object.entries(sources))await fs.writeFile(path.join(root,name),text);
const safe=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3368'],{cwd:path.join(repository,'study-log-web'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...safe,LOG_ROOT:root,BACKUP_ROOT:backups,APP_PASSWORD:'synthetic-loading-password',SESSION_SECRET:'synthetic-loading-session-secret-20261011',COOKIE_SECURE:'false',STUDY_LOG_MCP_URL:'http://127.0.0.1:1/mcp'}});
let log='';server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data);
try{
  let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch('http://127.0.0.1:3368/study-log')).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,log);
  console.log('Evidence:',evidence);
  if (process.argv[2] !== 'scroll-only') { const {stdout}=await promisify(execFile)(process.execPath,['ops/browser-log-loading.mjs','http://127.0.0.1:3368/study-log',evidence],{cwd:repository,windowsHide:true,timeout:900000});console.log(stdout); }
  const scroll=await promisify(execFile)(process.execPath,['ops/browser-inspector-scroll.mjs','http://127.0.0.1:3368/study-log',path.join(evidence,'inspector-scroll')],{cwd:repository,windowsHide:true,timeout:180000});console.log(scroll.stdout);
  for(const[name,text]of Object.entries(sources))assert.equal(await fs.readFile(path.join(root,name),'utf8'),text);
}finally{server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await fs.writeFile(path.join(evidence,'server.log'),log);}

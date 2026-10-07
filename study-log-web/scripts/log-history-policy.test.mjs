import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {getDay,saveDay} from '../lib/log-store.ts';import {listDayBackups} from '../lib/day-backup-store.ts';
test('history defaults, disabled writes, retention and ownership boundaries',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'history-policy-'));const data=path.join(root,'data'),backups=path.join(root,'backups');await fs.mkdir(data);await fs.mkdir(backups);
 const keys=['LOG_ROOT','BACKUP_ROOT','LOG_HISTORY_ENABLED','LOG_HISTORY_DAYS'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));process.env.LOG_ROOT=data;process.env.BACKUP_ROOT=backups;delete process.env.LOG_HISTORY_ENABLED;delete process.env.LOG_HISTORY_DAYS;
 t.after(async()=>{for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^history-policy-/);await fs.rm(root,{recursive:true,force:true});});
 let day=await saveDay({date:'2026-01-01',content:'### 标题\n\n第一版',baseVersion:null});
 const save=async text=>{day=await saveDay({date:day.date,content:'### 标题\n\n'+text,baseVersion:day.version});};
 await save('第二版');assert.equal((await fs.readdir(backups)).length,1);
 process.env.LOG_HISTORY_ENABLED='false';await save('第三版');assert.equal((await fs.readdir(backups)).length,1);assert.match((await getDay(day.date)).content,/第三版/);assert.ok((await listDayBackups(day.date)).write.length>0);
 process.env.LOG_HISTORY_ENABLED='true';process.env.LOG_HISTORY_DAYS='30';
 const old=`2026-01_学习日志.md.2020-01-01T00-00-00-000Z.${crypto.randomUUID()}.bak`,other=`2026-02_学习日志.md.2020-01-01T00-00-00-000Z.${crypto.randomUUID()}.bak`;
 for(const name of [old,other,'2026-01_学习日志.md.20200101-000000.bak','manual.slarchive'])await fs.writeFile(path.join(backups,name),'synthetic');
 await save('第四版');assert.equal(await fs.stat(path.join(backups,old)).catch(()=>null),null);for(const name of [other,'2026-01_学习日志.md.20200101-000000.bak','manual.slarchive'])assert.ok(await fs.stat(path.join(backups,name)));
 process.env.LOG_HISTORY_DAYS='0';await fs.writeFile(path.join(backups,old),'synthetic');await save('第五版');assert.ok(await fs.stat(path.join(backups,old)));
});

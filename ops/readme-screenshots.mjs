import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {parseEnv} from 'node:util';import {createRequire} from 'node:module';import {DesktopManager} from './desktop/manager.mjs';
const require=createRequire(new URL('../study-log-web/package.json',import.meta.url)),{chromium,expect}=require('@playwright/test');
const repo=path.resolve('.'),root=path.join(await fs.mkdtemp(path.join(os.tmpdir(),'study-log-readme-')),'instance');
const manager=new DesktopManager({packageRoot:repo,webRoot:path.join(repo,'study-log-web'),mcpRoot:path.join(repo,'study-log-mcp'),node:process.execPath});
await manager.select({root,create:true,password:'readme-synthetic-only-password'});
const content=`## 2026-10-08

### 1. 缓存读取策略

学习缓存时，容易把“加一层 Redis”当成完整方案。今天把读取顺序、失效条件和一致性问题放在一起整理。

#### Cache Aside 的读取流程

先查缓存，未命中时读取数据库，再把结果写回缓存。**缓存用于加速，数据库仍是数据来源。**

\`\`\`typescript
async function findArticle(id: string) {
  const cached = await cache.get(id);
  if (cached) return cached;
  const article = await database.find(id);
  if (article) await cache.set(id, article, { ttl: 300 });
  return article;
}
\`\`\`

#### 三种容易混淆的情况

| 情况 | 发生了什么 | 可考虑的处理 |
| --- | --- | --- |
| 缓存穿透 | 请求的数据本来就不存在 | 缓存空值、校验请求 |
| 缓存击穿 | 热点数据刚好过期 | 合并回源请求 |
| 缓存雪崩 | 大量缓存同时失效 | 分散过期时间、降级 |

### 2. 留待验证的问题

更新数据库后再删除缓存，仍可能遇到并发读取。下次用两个请求交错执行，观察旧值是否会被重新写入。
`;
await fs.writeFile(path.join(root,'data','2026-10_学习日志.md'),[
'## 2026-10-03\n\n### 1. HTTP 缓存\n\n区分强缓存与协商缓存，整理 Cache-Control 与 ETag。',
'## 2026-10-05\n\n### 1. 数据库索引\n\n复合索引的列顺序要结合查询条件理解。\n\n### 2. 查询计划\n\n记录 EXPLAIN 中需要关注的字段。',
'## 2026-10-07\n\n### 1. 并发控制\n\n比较乐观锁与悲观锁的适用场景。',content].join('\n\n---\n\n'));
await fs.writeFile(path.join(root,'data','2026-09_学习日志.md'),'## 2026-09-28\n\n### 1. TypeScript 类型收窄\n\n用控制流分析理解类型守卫。\n');
const output=path.join(repo,'docs/images');await fs.mkdir(output,{recursive:true});let browser;
try{await manager.start();browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1,colorScheme:'light'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(manager.url+'?date=2026-10-08');await page.getByLabel('访问密码').fill(parseEnv(await fs.readFile(path.join(root,'.env'),'utf8')).APP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.locator('.markdown-preview')).toContainText('缓存读取策略',{timeout:60000});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,'learning-log-light.png')});
await page.evaluate(()=>localStorage.setItem('study-log-theme','dark'));await page.reload();await expect(page.locator('.markdown-preview')).toContainText('缓存读取策略');await page.getByRole('button',{name:'分屏',exact:true}).click();await expect(page.locator('.cm-content')).toBeVisible();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,'markdown-split-dark.png')});
if(errors.length)throw Error(errors.join('\n'));console.log('Captured two real UI screenshots from synthetic learning material: '+output);
}finally{await browser?.close();await manager.shutdown();}

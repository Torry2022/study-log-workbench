import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium, webkit } from "@playwright/test";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.NAVIGATION_REPORT_DIR || path.join(webRoot, "..", ".local", `navigation-motion-${Date.now()}`));
const baseline = process.argv.includes("--baseline");
const webkitReduced = process.argv.includes("--webkit-reduced");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-navigation-"));
await fs.mkdir(output, { recursive: true });
const day = (date, count = 4) => [
  `## ${date}`, "",
  ...Array.from({ length: count }, (_, section) => [
    `### ${section + 1}. 合成小节${section + 1}`, "",
    ...Array.from({ length: 12 }, (_, line) => `${date} 小节${section + 1} 合成段落${line + 1}，用于验证导航和标题栏遮挡。\n`)
  ]).flat()
].join("\n");
await fs.writeFile(path.join(root, "2026-05_学习日志.md"), day("2026-05-01"));
await fs.writeFile(path.join(root, "2026-04_学习日志.md"), [day("2026-04-30"), day("2026-04-12"), day("2026-04-10")].join("\n\n---\n\n"));
const port = 3398;
const child = spawn(process.execPath, [path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: webRoot, windowsHide: true,
  env: { ...Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATH','Path','COMSPEC'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])), NODE_ENV: "production", LOG_ROOT: root, APP_PASSWORD: "synthetic-navigation-password", SESSION_SECRET: "synthetic-navigation-session-secret", COOKIE_SECURE: "false", CHAT_API_KEY: "", CHAT_LIGHT_API_KEY: "", STUDY_LOG_MCP_URL: "http://127.0.0.1:1/mcp" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
child.stdout.on("data", data => { serverLog += data; });
child.stderr.on("data", data => { serverLog += data; });
const results = [];
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(serverLog);
    if (await fetch(`http://127.0.0.1:${port}/study-log/`).then(r => r.ok).catch(() => false)) break;
    if (attempt === 119) throw new Error("Synthetic server did not start");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  for (const engine of baseline ? ["chromium"] : webkitReduced ? ["webkit"] : ["chromium", "webkit"]) {
    const browser = await ({ chromium, webkit }[engine]).launch();
    try {
      const scenarios = baseline ? [{ reducedMotion: "no-preference", theme: "light" }] : webkitReduced ? [{reducedMotion:'reduce',theme:'dark'}] : [
        { reducedMotion: "no-preference", theme: "light" },
        { reducedMotion: "no-preference", theme: "dark" },
        { reducedMotion: "reduce", theme: "dark" }
      ];
      for (const { reducedMotion, theme } of scenarios) {
        const page = await browser.newPage({ viewport: { width: 1720, height: 900 }, reducedMotion });
        const prefix = `${engine}-${theme}-${reducedMotion}`;
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript(theme => {
          localStorage.setItem("study-log-theme", theme);
          // Keep real browser snapshots, but widen their deferred update window.
          if (document.startViewTransition) {
            const native = document.startViewTransition.bind(document);
            document.startViewTransition = callback => native(async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              await callback();
            });
          }
        }, theme);
        await page.goto(`http://127.0.0.1:${port}/study-log/?date=2026-05-01`);
        await page.getByLabel("访问密码").fill("synthetic-navigation-password");
        await page.getByRole("button", { name: "登录", exact: true }).click();
        await page.locator('.markdown-preview').getByText("2026-05-01 小节4 合成段落12，用于验证导航和标题栏遮挡。", { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.route("**/api/logs?month=2026-04", async route => {
          await new Promise(resolve => setTimeout(resolve, 350));
          await route.continue();
        });
        await page.getByRole("button", { name: "按日期跳转", exact: true }).click();
        await page.locator('.date-jump-popover input[type="month"]').fill("2026-04");
        await page.getByRole("button", { name: "跳转到 2026-04-12", exact: true }).waitFor();
        await page.getByRole("button", { name: "跳转到 2026-04-12", exact: true }).click();
        await page.waitForTimeout(900);
        const firstDate = await page.locator('.app-shell .reader .reader-toolbar-log .reader-log-identity h2').innerText();
        await page.screenshot({ path: path.join(output, `${prefix}-date.png`) });
        results.push({ engine, theme, reducedMotion, firstDate });
        if (!baseline) assert.equal(firstDate, "2026-04-12", "One click must keep the requested date instead of the month's first day");
        // The same actual sidebar entry must reach its fourth section in one click.
        await page.locator('.sidebar .day-item').filter({ hasText: "04-12" }).getByRole("button", { name: "合成小节4", exact: true }).click();
        await page.waitForTimeout(900);
        const target = page.locator('.app-shell .reader .preview-pane .markdown-preview h3').filter({ hasText: "合成小节4" });
        await target.waitFor({ state: "visible" });
        await page.screenshot({ path: path.join(output, `${prefix}-section.png`) });
        await page.waitForFunction(() => {
          const heading = document.querySelector('.app-shell .reader .preview-pane .markdown-preview h3[id="4-合成小节4"]');
          const toolbar = document.querySelector('.app-shell .reader .reader-toolbar-log');
          if (!heading || !toolbar) return false;
          const rect = heading.getBoundingClientRect();
          return rect.height > 0 && rect.top >= toolbar.getBoundingClientRect().bottom - 3 && rect.top < 850;
        });
        const targetBox = await target.evaluate(element => { const box = element.getBoundingClientRect(); return { y: box.y, height: box.height }; });
        const toolbar = page.locator('.app-shell .reader .reader-toolbar-log');
        const toolbarBox = await toolbar.boundingBox();
        if (!baseline) assert.ok(targetBox && targetBox.y >= toolbarBox.y + toolbarBox.height - 3 && targetBox.y < 850, "The requested section must be visible below the toolbar");
        await page.getByRole("button", { name: "源码", exact: true }).click();
        await page.waitForTimeout(650);
        await page.addStyleTag({ content: '::view-transition-old(workspace-content), ::view-transition-new(workspace-content), ::view-transition-group(workspace-content) { animation-duration: 1200ms !important; } .workspace-content-revealing { animation-duration: 1200ms !important; }' });
        await page.getByRole("button", { name: "浏览", exact: true }).click();
        await page.waitForTimeout(180);
        await page.screenshot({ path: path.join(output, `${prefix}-mode-middle.png`) });
        const transition = await page.evaluate(() => ({
          kind: document.documentElement.dataset.workspaceTransition,
          rootName: getComputedStyle(document.documentElement).viewTransitionName,
          oldClip: getComputedStyle(document.documentElement, "::view-transition-old(workspace-content)").clipPath,
          oldOpacity: getComputedStyle(document.documentElement, "::view-transition-old(workspace-content)").opacity,
          newClip: getComputedStyle(document.documentElement, "::view-transition-new(workspace-content)").clipPath,
          groupClip: getComputedStyle(document.documentElement, "::view-transition-group(workspace-content)").clipPath,
          groupTransform: getComputedStyle(document.documentElement, "::view-transition-group(workspace-content)").transform,
          toolbarBottom: document.querySelector('.app-shell .reader .reader-toolbar-log').getBoundingClientRect().bottom,
          snapshots: document.querySelectorAll('.workspace-transition-snapshot').length
        }));
        results.at(-1).transition = transition;
        if (!baseline) {
          assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.effect?.pseudoElement?.startsWith("::view-transition")).length), 0,
            "Reading-position restoration must use the live CSS transition instead of frozen native snapshots");
        }
        await page.waitForTimeout(1400);
        await page.screenshot({ path: path.join(output, `${prefix}-mode-end.png`) });
        if (!baseline) {
          assert.equal(await page.locator('.app-shell .reader .reader-toolbar-log .reader-log-identity h2').innerText(), "2026-04-12");
          assert.equal(await page.locator('.workspace-transition-snapshot').count(), 0);
          assert.deepEqual(errors, []);
        }
        await page.mouse.move(700,400);await page.mouse.wheel(0,10000);
        await page.locator('.compact-day-navigator.visible').getByRole("button", { name: "选择日期", exact: true }).click();
        await page.locator('.compact-day-menu .day-item').filter({ hasText: "04-30" }).locator('.day-item-open').click();
        await page.waitForFunction(() => document.querySelector('.app-shell .reader .reader-toolbar-log .reader-log-identity h2')?.textContent === "2026-04-30");
        await page.locator('.app-shell .reader .markdown-preview').getByText("2026-04-30 小节4 合成段落12，用于验证导航和标题栏遮挡。", { exact: true }).waitFor();
        await page.waitForFunction(() => !document.documentElement.dataset.workspaceTransition && window.scrollY === 0);
        // Reduced motion has no animation delay: let the loaded draft and its
        // reading-position frame settle before issuing the next user scroll.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.mouse.move(700,400);await page.mouse.wheel(0,10000);
        await page.locator('.compact-day-navigator.visible').getByRole("button", { name: "选择日期", exact: true }).click();
        await page.locator('.compact-day-menu .day-item').filter({ hasText: "04-12" }).getByRole("button", { name: "合成小节4", exact: true }).click();
        await page.waitForFunction(() => {
          const heading = document.querySelector('.app-shell .reader .preview-pane [id="4-合成小节4"]');
          const toolbar = document.querySelector('.app-shell .reader .reader-toolbar-log');
          if (!heading || !toolbar || toolbar.querySelector('.reader-log-identity h2')?.textContent !== "2026-04-12") return false;
          const rect = heading.getBoundingClientRect();
          return rect.height > 0 && rect.top >= toolbar.getBoundingClientRect().bottom - 3 && rect.top < 850;
        });
        await page.waitForFunction(() => !document.documentElement.dataset.workspaceTransition && Math.abs(document.querySelector('.app-shell .reader .reader-toolbar-log').getBoundingClientRect().top) <= 1);
        await page.screenshot({ path: path.join(output, `${prefix}-bottom-navigation.png`) });
        results.at(-1).bottomNavigationDate = await page.locator('.app-shell .reader .reader-toolbar-log .reader-log-identity h2').innerText();
        if (!baseline) {
          for (const mode of ['源码', '分屏', '浏览', '源码', '浏览']) {
            await page.getByRole('button', {name:mode,exact:true}).click();
          }
          await page.waitForFunction(()=>!document.documentElement.dataset.workspaceTransition);
          assert.equal(await page.locator('.app-shell .reader .reader-content.mode-preview').count(),1);
          assert.equal(await page.locator('.workspace-transition-snapshot').count(),0);
          await page.screenshot({path:path.join(output,`${prefix}-rapid-mode-end.png`)});

          await page.getByRole('button',{name:'源码',exact:true}).click();
          const editor=page.locator('.app-shell .cm-content');
          await editor.waitFor({state:'visible'});await editor.click();await editor.press('Control+End');
          await page.keyboard.insertText('\nNAVIGATION_SYNTHETIC_DRAFT');
          await page.getByRole('button',{name:'分屏',exact:true}).click();
          await page.getByRole('button',{name:'浏览',exact:true}).click();
          await page.getByRole('button',{name:'源码',exact:true}).click();
          assert.ok((await editor.innerText()).includes('NAVIGATION_SYNTHETIC_DRAFT'));
          await page.getByRole('button',{name:'随记',exact:true}).click();
          const dialog=page.getByRole('alertdialog');await dialog.getByRole('button',{name:'取消',exact:true}).click();
          await dialog.waitFor({state:'hidden'});
          assert.ok((await editor.innerText()).includes('NAVIGATION_SYNTHETIC_DRAFT'));
          await page.getByRole('button',{name:'随记',exact:true}).click();
          await dialog.getByRole('button',{name:'放弃修改',exact:true}).click();
          await page.waitForTimeout(180);
          await page.screenshot({path:path.join(output,`${prefix}-module-middle.png`)});
          const moduleClip=await page.evaluate(()=>({
            kind:document.documentElement.dataset.workspaceTransition,
            clip:getComputedStyle(document.documentElement,'::view-transition-group(workspace-content)').clipPath,
            top:document.documentElement.style.getPropertyValue('--workspace-transition-top'),
            snapshotClips:[...document.querySelectorAll('.workspace-transition-snapshot')].map(element=>element.style.clipPath)
          }));
          if (engine==='chromium'&&reducedMotion!=='reduce') assert.ok(moduleClip.clip.startsWith('inset('),JSON.stringify(moduleClip));
          for(const clip of moduleClip.snapshotClips) assert.ok(clip.startsWith('inset('));
          await page.waitForFunction(()=>!document.documentElement.dataset.workspaceTransition);
          await page.getByRole('button',{name:'日志',exact:true}).filter({visible:true}).click();
          await page.waitForFunction(()=>!document.documentElement.dataset.workspaceTransition);
          await page.screenshot({path:path.join(output,`${prefix}-module-end.png`)});
          results.at(-1).moduleClip=moduleClip;
          results.at(-1).rapidModesAndDraft=true;
          assert.deepEqual(errors,[]);
        }
        await page.close();
      }
    } catch(error) {
      for(const page of browser.contexts().flatMap(context=>context.pages())){
        await page.screenshot({path:path.join(output,`${engine}-failure.png`)}).catch(()=>{});
        await fs.writeFile(path.join(output,`${engine}-failure.json`),JSON.stringify(await page.evaluate(()=>({
          scrollY:window.scrollY,height:document.documentElement.scrollHeight,viewport:innerHeight,
          date:document.querySelector('.reader-log-identity h2')?.textContent,
          transition:document.documentElement.dataset.workspaceTransition,
          sidebar:document.querySelector('.sidebar')?.getBoundingClientRect().toJSON(),
          navigator:document.querySelector('.compact-day-navigator')?.outerHTML
        })).catch(()=>({})),null,2));
      }
      throw error;
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(output, baseline ? "baseline.json" : "results.json"), JSON.stringify(results, null, 2));
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once("exit", resolve));
  await fs.writeFile(path.join(output, "server.log"), serverLog);
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("study-log-navigation-"));
  await fs.rm(root, { recursive: true, force: true });
}

import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local synthetic fixture required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
let page;
const date = "2026-09-14";
const otherDate = "2026-09-17", otherMarker = "B19 标注切日合成目标";
const original = "### 标注验收\n\n核心概念与机制需要理解。\n\n`代码核心概念` 与 [链接](https://example.com) 保留。\n\n" + Array.from({ length: 90 }, (_, i) => `第 ${i + 1} 行正文：用于验证原文与标注版本的独立滚动。`).join("\n");
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const panel = page.locator(".highlight-panel"), dialog = page.getByRole("dialog", { name: "AI 重点标注差异查看", exact: true });
  const editor = page.locator(".cm-content").filter({ visible: true });
  const day = async () => (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  const open = async () => {
    await page.locator(".workspace").waitFor();
    if (!await panel.isVisible()) {
      if (page.viewportSize().width <= 1023) {
        if (!await page.locator(".writing-inspector.mobile-open").count()) { await page.getByRole("button", { name: "更多设置", exact: true }).click(); await page.getByRole("button", { name: "AI 工具", exact: true }).click(); }
      } else if (await page.getByRole("button", { name: "展开右侧栏", exact: true }).count()) await page.getByRole("button", { name: "展开右侧栏", exact: true }).click();
      await page.getByRole("button", { name: "AI标注", exact: true }).filter({ visible: true }).last().click();
    }
    await expect(panel).toBeVisible();
  };
  const request = async () => { await page.getByRole("button", { name: "标注重点", exact: true }).click(); await expect(dialog).toBeVisible(); };
  const close = async () => { await dialog.getByRole("button", { name: "关闭", exact: true }).click(); await expect(dialog).toHaveCount(0); };
  const source = async () => { const button = page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true }); if (await button.count()) await button.click(); else await page.getByLabel("工作区模式", { exact: true }).filter({ visible: true }).selectOption("source"); await expect(editor).toBeVisible(); };
  let configured = false, responseStatus = 200, unchanged = false, calls = 0, pending = null;
  // No request to a real model is ever permitted by this scenario.
  await page.route("**/api/ai/bold-highlights", async route => {
    calls++; const input = route.request().postDataJSON(); assert.equal(input.date, date);
    const content = unchanged ? input.content : input.content.replace(/(?<!\*)核心概念与机制(?!\*)/, "**核心概念与机制**");
    const result = { content, model: "synthetic-highlight-mock", boldCount: content === input.content ? 0 : 1, warnings: content === input.content ? ["没有新增标注，原文保持不变"] : ["合成标注提示"] };
    const response = responseStatus === 200 ? { status: 200, json: { result } } : { status: responseStatus, json: { error: responseStatus === 401 ? "Unauthorized" : "合成标注失败" } };
    if (pending) { const gate = pending; gate.started(); await gate.promise; }
    await route.fulfill(response).catch(() => {});
  });
  await page.route("**/api/capabilities", async route => {
    const response = await route.fetch(); const json = await response.json();
    if (response.ok()) { json.features.aiHighlighting = { supported: true, configured }; json.aiConfiguration.provider = { configured, issues: configured ? [] : [{ message: "合成标注模型未配置" }] }; json.aiConfiguration.templates.highlighting = { configured: true }; }
    await route.fulfill({ response, json });
  });
  function delayed() { let release, started; const promise = new Promise(resolve => release = resolve), seen = new Promise(resolve => started = resolve); pending = { promise, started }; return { seen, release: () => { release(); pending = null; } }; }
  await page.goto(base); await login(); const before = await day(); assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: original, baseVersion: before.version } })).status(), 200);
  const other = (await (await page.request.get(`${base}/api/logs/day?date=${otherDate}`)).json()).day;
  if (other.exists) assert.ok(other.content.includes(otherMarker), "Secondary date belongs to another fixture; do not overwrite it");
  else assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date: otherDate, content: `### ${otherMarker}\n\n只用于确认旧标注不会进入切换后的日块。`, baseVersion: other.version } })).status(), 200);
  await page.goto(`${base}?date=${date}`); await open(); await expect(panel).toContainText("合成标注模型未配置"); await expect(page.getByRole("button", { name: "标注重点", exact: true })).toBeDisabled(); assert.equal(calls, 0);
  await expect(page.getByRole("button", { name: "重新检查标注配置", exact: true })).toBeEnabled(); configured = true; await page.getByRole("button", { name: "重新检查标注配置", exact: true }).click(); await expect(page.getByRole("button", { name: "标注重点", exact: true })).toBeEnabled();
  await source(); const savedVersion = (await day()).version;
  await request(); await expect(dialog.locator(".diff-bold-token")).toHaveCount(2); await expect(dialog.getByLabel("原始 Markdown", { exact: true })).toContainText("核心概念与机制"); await expect(dialog.getByLabel("标注后的 Markdown", { exact: true })).toContainText("**核心概念与机制**"); assert.equal((await day()).version, savedVersion);
  await close(); await expect(editor).not.toContainText("**核心概念与机制**"); assert.equal((await day()).version, savedVersion);
  // A failed rerun retains the old review and never changes the editor.
  await request(); responseStatus = 502; await dialog.getByRole("button", { name: "重新标注", exact: true }).click(); await expect(dialog).toContainText("合成标注失败"); await expect(dialog.locator(".diff-bold-token")).toHaveCount(2); responseStatus = 200;
  await dialog.getByRole("button", { name: "重新标注", exact: true }).click(); await expect(dialog).not.toContainText("合成标注失败"); await close();
  // Typing while the request is pending makes its review stale; applying must refuse.
  const stale = delayed(); await page.getByRole("button", { name: "标注重点", exact: true }).click(); await stale.seen; await editor.click(); await editor.press("Control+End"); await page.keyboard.insertText("\n请求期间继续输入。"); stale.release(); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("当前编辑草稿已变化"); await dialog.getByRole("button", { name: "应用到当前草稿", exact: true }).click(); await expect(dialog).toBeVisible(); await expect(dialog).toContainText("请重新标注");
  await dialog.getByRole("button", { name: "重新标注", exact: true }).click(); await expect(dialog.getByLabel("原始 Markdown", { exact: true })).toContainText("请求期间继续输入");
  await fs.mkdir(path.resolve("artifacts/highlighting"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/highlighting/desktop.png") });
  await dialog.getByRole("button", { name: "应用到当前草稿", exact: true }).click(); await expect(dialog).toHaveCount(0); await editor.press("Control+Home"); await expect(editor).toContainText("**核心概念与机制**"); await editor.press("Control+End"); await expect(editor).toContainText("请求期间继续输入"); assert.equal((await day()).version, savedVersion);
  await page.getByRole("button", { name: "保存", exact: true }).filter({ visible: true }).click(); await expect.poll(async () => (await day()).content).toContain("**核心概念与机制**");
  unchanged = true; await request(); await expect(dialog).toContainText("没有新增标注"); await expect(dialog.getByRole("button", { name: "应用到当前草稿", exact: true })).toBeDisabled(); await close(); unchanged = false;
  console.log("Highlighting: configuration, review-only, close, rerun failure, stale content rejection, apply-before-save and no-change warnings passed");

  // Late responses are discarded after date/module changes and expired authentication.
  for (const destination of ["date", "module"]) {
    const late = delayed(); await page.getByRole("button", { name: "标注重点", exact: true }).click(); await late.seen;
    if (destination === "date") { await page.locator(".day-item").filter({ hasText: otherDate }).click(); await expect(page).toHaveURL(new RegExp(`date=${otherDate}`)); }
    else { await page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true }).first().click(); await expect(page.getByLabel("搜索收藏", { exact: true })).toBeVisible(); }
    late.release(); await expect(dialog).toHaveCount(0);
    if (destination === "module") await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click();
    await page.locator(".day-item").filter({ hasText: date }).click(); await open(); await expect(dialog).toHaveCount(0);
  }
  await editor.click(); await editor.press("Control+End"); await page.keyboard.insertText("\n认证过期保留原稿。"); const expired = delayed(); await page.getByRole("button", { name: "标注重点", exact: true }).click(); await expired.seen;
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(page.getByLabel("访问密码")).toBeVisible(); expired.release(); await login(); await open(); await expect(dialog).toHaveCount(0); await expect(editor).toContainText("认证过期保留原稿");
  responseStatus = 401; await page.getByRole("button", { name: "标注重点", exact: true }).click(); await expect(page.getByLabel("访问密码")).toBeVisible(); responseStatus = 200; await login(); await open(); await expect(editor).toContainText("认证过期保留原稿");
  await request(); await page.setViewportSize({ width: 390, height: 844 }); await expect(dialog).toBeVisible();
  const originalPane = dialog.getByLabel("原始 Markdown", { exact: true }), highlightedPane = dialog.getByLabel("标注后的 Markdown", { exact: true });
  await expect(highlightedPane).toBeVisible(); await expect(originalPane).not.toBeVisible();
  await highlightedPane.locator("pre").evaluate(element => { element.scrollTop = 240; }); await dialog.getByRole("button", { name: "原文", exact: true }).click(); await expect(originalPane).toBeVisible(); await originalPane.locator("pre").evaluate(element => { element.scrollTop = 100; }); await dialog.getByRole("button", { name: "标注后", exact: true }).click();
  assert.ok(Math.abs(await highlightedPane.locator("pre").evaluate(element => element.scrollTop) - 240) < 2); await dialog.getByRole("button", { name: "原文", exact: true }).click(); assert.ok(Math.abs(await originalPane.locator("pre").evaluate(element => element.scrollTop) - 100) < 2);
  await page.screenshot({ path: path.resolve("artifacts/highlighting/mobile.png") }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await close(); await open(); await request();
  for (let index = 0; index < 12; index++) { await page.keyboard.press(index % 2 ? "Shift+Tab" : "Tab"); assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true); }
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(panel).toBeVisible(); assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden"); assert.equal(await panel.locator("..").evaluate(element => element.contains(document.activeElement)), true);
  await request(); await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(dialog).toHaveCount(0); await login(); assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden"); await expect(page.locator(".workspace")).toBeVisible();
  assert.deepEqual(errors, []); console.log("Passed: highlighting late date/module/auth responses, 401 draft retention, mobile independent scroll and modal expiration cleanup");
} finally { await page?.unrouteAll({ behavior: "ignoreErrors" }); await browser.close(); }

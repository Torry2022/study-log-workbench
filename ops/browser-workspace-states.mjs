import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect, request } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3578/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || new URL(base).port === "3577") throw Error("Explicit isolated synthetic instance required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const api = await request.newContext();
assert.ok((await api.post(`${base}/api/auth/login`, { data: { password: env.APP_PASSWORD } })).ok());
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 900 } });
const errors = [];
context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
await context.route("**/api/ai/**", route => route.abort());
await context.route("**/api/rag/query", route => route.abort());
const artifacts = path.resolve("artifacts/workspace-states");
await fs.mkdir(artifacts, { recursive: true });
const date = "2026-01-15";
async function held(page, pattern, response) {
  let release, seen;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => seen = resolve);
  await page.route(pattern, async route => { seen(); await gate; if (response) await route.fulfill(response).catch(() => {}); else await route.continue().catch(() => {}); });
  return { release, started };
}
async function shape(state, kind) {
  await expect(state).toBeVisible();
  await expect(state.locator(":scope > .workspace-state-body")).toHaveCount(1);
  await expect(state.locator(".workspace-state-icon svg")).toBeVisible();
  await expect(state.locator(".workspace-state-title")).toBeVisible();
  await expect(state).toHaveAttribute("role", kind === "error" ? "alert" : "status");
  if (kind === "loading") assert.equal(await state.locator(".workspace-state-icon svg").evaluate(element => getComputedStyle(element).animationName), "workspace-state-spin");
}
try {
  const auth = await context.newPage(), gate = await held(auth, "**/api/auth/me");
  await auth.goto(base); await gate.started;
  await shape(auth.locator(".workspace-state-fullscreen"), "loading");
  assert.ok(await auth.locator(".workspace-state-body").evaluate(element => { const r = element.getBoundingClientRect(); return Math.abs(r.y + r.height / 2 - innerHeight / 2) < 2; }));
  gate.release(); await expect(auth.locator(".workspace")).toBeVisible(); await auth.close();

  for (const width of [1920, 1440, 390]) {
    const page = await context.newPage(); await page.setViewportSize({ width, height: 900 });
    const loading = await held(page, "**/api/logs/day?*");
    await page.goto(`${base}?view=log&date=${date}`); await loading.started;
    const preview = page.locator(".preview-loading").filter({ visible: true });
    await shape(preview, "loading"); await expect(preview).toContainText(`正在加载 ${date}`);
    const placement = await preview.evaluate(element => {
      const body = element.querySelector(".workspace-state-body"), title = element.querySelector(".workspace-state-title"), icon = element.querySelector(".workspace-state-icon");
      return { display: getComputedStyle(body).display, justify: getComputedStyle(body).justifyContent, margin: getComputedStyle(body).marginTop, text: title.getBoundingClientRect().toJSON(), icon: icon.getBoundingClientRect().toJSON() };
    });
    assert.equal(placement.display, "flex"); assert.equal(placement.justify, "flex-start"); assert.equal(placement.margin, "34px"); assert.ok(placement.icon.left > placement.text.right, "Original log spinner follows the title");
    const columns = await preview.evaluate(element => {
      const pane = element.closest(".preview-pane"), workspace = element.closest(".preview-workspace");
      if (!pane || !workspace) return null;
      return { className: workspace.className, paneWidth: pane.getBoundingClientRect().width, totalWidth: workspace.getBoundingClientRect().width };
    });
    assert.ok(columns, "Loading state must remain inside the original preview layout");
    if (width > 1180) {
      assert.match(columns.className, /has-outline/);
      assert.ok(Math.abs(columns.totalWidth - columns.paneWidth - 224) < 1, "Original loading layout reserves the outline column");
    } else assert.ok(Math.abs(columns.totalWidth - columns.paneWidth) < 1);
    await page.screenshot({ path: path.join(artifacts, `log-loading-${width}.png`) });
    await page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true }).click();
    await shape(page.locator(".source-empty").filter({ visible: true }), "loading");
    loading.release(); await expect(page.locator(".cm-content")).toBeVisible(); await page.close();
  }

  for (const [view, endpoint, className, payload, inputLabel] of [
    ["notes", "**/api/notes", ".notes-state", { notes: [], years: [], tags: [] }, "搜索随记"],
    ["favorites", "**/api/favorites", ".favorites-empty-state", { favorites: [], groups: [] }, "搜索收藏"]
  ]) {
    const page = await context.newPage(), loading = await held(page, endpoint, { json: payload });
    await page.goto(`${base}?view=${view}&date=${date}`); await loading.started;
    const state = page.locator(`.workspace-view:not([hidden]) ${className}`);
    await shape(state, "loading");
    const input = page.getByLabel(inputLabel, { exact: true }); await input.focus();
    loading.release(); await expect(state).toHaveClass(/workspace-state-empty/); await shape(state, "empty");
    await expect(input).toBeFocused(); await expect(state.locator("button")).toHaveCount(0);
    await expect(state.locator(".workspace-state-description")).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, `${view}-empty.png`) }); await page.close();
  }

  const stats = await context.newPage(), statsLoad = await held(stats, "**/api/stats?*");
  await stats.goto(`${base}?view=stats&month=2026-01&date=${date}`); await statsLoad.started;
  await shape(stats.locator(".stats-workspace .workspace-state-loading"), "loading");
  statsLoad.release(); await expect(stats.locator(".stats-workspace .workspace-state-loading")).toHaveCount(0); await stats.close();

  const qa = await context.newPage(), id = "00000000-0000-4000-8000-000000000024";
  const session = { id, title: "合成加载会话", titleSource: "manual", createdAt: "2026-01-15T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z", messageCount: 2, lastQuestion: "合成问题", answerMode: "logs_only", version: "a".repeat(64), messages: [{ id: "u", role: "user", content: "合成问题", status: "complete" }, { id: "a", role: "assistant", content: "合成回答", status: "complete" }] };
  const qaLoad = await held(qa, `**/api/rag/sessions/${id}`, { json: { session } });
  await qa.goto(`${base}?view=qa&session=${id}&date=${date}`); await qaLoad.started;
  await shape(qa.locator(".rag-conversation .workspace-state-loading"), "loading");
  qaLoad.release(); await expect(qa.locator(".rag-conversation")).toContainText("合成回答");
  await qa.goto(`${base}?view=qa&date=${date}`); await shape(qa.locator(".rag-conversation .workspace-state-empty"), "empty"); await qa.close();

  const failure = await context.newPage(); let fail = true;
  await failure.route("**/api/logs/day?*", route => fail ? route.fulfill({ status: 500, json: { error: "合成读取失败" } }) : route.continue());
  await failure.goto(`${base}?view=log&date=${date}`);
  const error = failure.locator(".preview-empty.workspace-state-error"); await shape(error, "error"); await expect(error).toContainText("合成读取失败");
  fail = false; await error.getByRole("button", { name: "重新加载", exact: true }).click(); await expect(error).toHaveCount(0);
  await failure.goto(`${base}?view=log&date=2026-01-16`); await shape(failure.locator(".preview-empty.workspace-state-empty"), "empty"); await expect(failure.locator(".preview-empty")).toContainText("暂无正文"); await failure.close();
  assert.deepEqual(errors, []);
  console.log("Passed: shared auth/log/source/notes/favorites/stats/RAG loading and empty states; original log placement, error retry, focus retention and mobile layout. No fixture writes or model calls.");
} finally { await context.close(); await browser.close(); await api.dispose(); }

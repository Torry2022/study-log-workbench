import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, firefox, webkit, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log", engine = "chromium"] = process.argv.slice(2);
if (!["chromium", "firefox", "webkit"].includes(engine)) throw Error("Unsupported Playwright engine");
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local synthetic fixture required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const prefix = `B24问答验收-${Date.now()}`, date = "2026-09-18", marker = "B23 RAG 合成引用目标";
const uuid = () => `b0240000-${crypto.randomUUID().slice(9)}`;
const citation = { sourceId: "S1", date, month: "2026-09", fileName: "2026-09_学习日志.md", heading: marker, headingIndex: 0, chunkId: "b24-synthetic-chunk", contentHash: "b24-synthetic-content", excerpt: "合成引用：学习记录是问答的原始依据。" };
const longAnswer = `合成回答引用 [S1]。\n\n` + Array.from({ length: 70 }, (_, i) => `第${i + 1}段：这是用于阅读位置与历史侧栏验收的独立合成回答。`).join("\n\n");
let streamMode = "done", streamStarted, finishStream, page, saveMode = "normal", renameFailure = false, deleteMalformed = false;
const packet = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const mock = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", new URL(base).origin);
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  let raw = ""; for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw); assert.ok(input.question.startsWith(prefix), "Only this script's synthetic questions may reach the mock");
  response.setHeader("Content-Type", "text/event-stream"); response.setHeader("Cache-Control", "no-store");
  response.write(packet("status", { message: "正在检索合成日志" }));
  response.write(packet("sources", { citations: [citation] }));
  response.write(packet("delta", { text: "合成流式片段" }));
  if (streamMode === "hold") { finishStream = () => { if (!response.destroyed) { response.write(packet("done", { answer: longAnswer, citations: [citation] })); response.end(); } }; streamStarted?.(); return; }
  if (streamMode === "eof") { response.end(); return; }
  response.write(packet("done", { answer: longAnswer, citations: [citation], groundingWarning: "合成依据边界提示" })); response.end();
});
await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
const browser = await ({ chromium, firefox, webkit })[engine].launch();
const owned = new Set();
const artifactRoot = path.resolve("artifacts/rag", engine === "chromium" ? "" : engine);
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const question = page.getByRole("textbox", { name: "输入知识库问题", exact: true });
  const workspace = page.locator(".rag-workspace").filter({ visible: true });
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const confirm = async name => { await page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0); };
  const allSessions = async () => (await (await page.request.get(`${base}/api/rag/sessions`)).json()).sessions;
  const ownSessions = async () => (await allSessions()).filter(session => owned.has(session.id) || session.lastQuestion.startsWith(prefix));
  const get = async id => (await (await page.request.get(`${base}/api/rag/sessions/${id}`)).json()).session;
  const center = async () => { await page.getByRole("button", { name: "问答", exact: true }).filter({ visible: true }).first().click(); await expect(question).toBeVisible(); };
  const history = async () => { if (page.viewportSize().width <= 1023) { if (!await page.locator(".sidebar.mobile-open").count()) await page.getByRole("button", { name: "打开日志导航", exact: true }).click(); } else if (await page.getByRole("button", { name: "展开左侧栏", exact: true }).count()) await page.getByRole("button", { name: "展开左侧栏", exact: true }).click(); };
  const fresh = async () => { await history(); await page.getByRole("button", { name: "新建问答", exact: true }).filter({ visible: true }).first().click(); await expect(question).toHaveValue(""); await expect(workspace.locator(".rag-message")).toHaveCount(0); };
  const send = async suffix => { await question.fill(`${prefix}${suffix}`); await page.getByRole("button", { name: "发送问题", exact: true }).click(); };
  const openSession = async session => { await history(); await page.locator(".rag-session-main").filter({ hasText: session.title }).first().click(); await expect(page).toHaveURL(new RegExp(`session=${session.id}`)); await expect(question).toBeVisible(); await expect(page.locator(".rag-session-item.active")).toContainText(session.title); await expect.poll(() => page.locator(".rag-session-item.active").evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.bottom <= innerHeight + 1; })).toBe(true).catch(async error => { console.log("Active history bounds", await page.locator(".rag-session-item.active").evaluate(element => ({ item: element.getBoundingClientRect().toJSON(), list: element.closest(".rag-history-groups").getBoundingClientRect().toJSON(), sidebar: element.closest(".sidebar").getBoundingClientRect().toJSON(), windowHeight: innerHeight, scroll: scrollY }))); throw error; }); };
  const hold = () => { streamMode = "hold"; return new Promise(resolve => { streamStarted = resolve; }); };
  const savedRequests = [];
  // Permanent interception terminates exclusively at this process's loopback mock SSE server.
  await page.route("**/api/rag/query", route => streamMode === "401" ? route.fulfill({ status: 401, json: { error: "Unauthorized" } }) : route.continue({ url: `http://127.0.0.1:${mock.address().port}/sse` }));
  await page.route("**/api/capabilities", async route => { const response = await route.fetch(), json = await response.json(); if (response.ok()) json.features.rag = { supported: true, configured: true }; await route.fulfill({ response, json }); });
  await page.route("**/api/rag/sessions/*/title", async route => { const url = route.request().url().replace(/\/title$/, ""); const response = await page.request.get(url); await route.fulfill({ response }); });
  await page.route("**/api/rag/sessions", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON(); owned.add(body.id);
    if (saveMode !== "normal" || savedRequests.length) savedRequests.push(body);
    if (saveMode === "500") { saveMode = "malformed"; await route.fulfill({ status: 500, json: { error: "合成历史保存失败" } }); return; }
    const response = await route.fetch(); assert.equal(response.status(), 200);
    if (saveMode === "malformed") { saveMode = "normal"; await route.fulfill({ status: 200, json: {} }); } else await route.fulfill({ response });
  });
  await page.route(/\/api\/rag\/sessions\/[a-f0-9-]+$/, async route => {
    const method = route.request().method();
    if (method === "PATCH" && renameFailure) { renameFailure = false; await route.fulfill({ status: 500, json: { error: "合成重命名失败" } }); return; }
    if (method === "DELETE" && deleteMalformed) { deleteMalformed = false; await route.fulfill({ status: 200, json: {} }); return; }
    await route.continue();
  });
  await page.goto(base); await login();
  const day = (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  if (day.exists) assert.ok(day.content.includes(marker), "Do not overwrite another fixture date");
  else assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, baseVersion: day.version, content: `### ${marker}\n\n${citation.excerpt}` } })).status(), 200);
  const existingSessionCount = (await allSessions()).length;
  const seeded = [];
  for (let index = 0; index < 22; index++) {
    const id = uuid(); owned.add(id);
    const messages = [{ id: uuid(), role: "user", content: `${prefix}更早问题独特词${index}`, status: "complete" }, { id: uuid(), role: "assistant", content: longAnswer, status: "complete", citations: [citation] }, { id: uuid(), role: "user", content: `${prefix}最新问题${index}`, status: "complete" }, { id: uuid(), role: "assistant", content: `历史末尾${index}`, status: "complete" }];
    const response = await page.request.post(`${base}/api/rag/sessions`, { data: { id, mutationId: uuid(), baseVersion: null, answerMode: "logs_only", messages } }); assert.equal(response.status(), 200);
    const session = (await response.json()).session; const renamed = await page.request.patch(`${base}/api/rag/sessions/${id}`, { data: { mutationId: uuid(), baseVersion: session.version, title: `${prefix}历史${index}` } }); assert.equal(renamed.status(), 200); seeded.push((await renamed.json()).session);
  }
  await center(); await send("第一问"); await expect(workspace).toContainText("合成依据边界提示"); await expect.poll(async () => (await ownSessions()).length).toBe(23); await expect(page).toHaveURL(/session=/); const firstId = new URL(page.url()).searchParams.get("session"); owned.add(firstId); await expect(page.getByRole("button", { name: "发送问题", exact: true })).toBeDisabled();
  assert.equal((await get(firstId)).messages[1].status, "complete");
  const sourceButton = workspace.locator(".rag-citation").first(); await sourceButton.click(); await workspace.getByRole("button", { name: "查看原日志", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`date=${date}`)); await expect(page.locator(".markdown-preview").filter({ visible: true })).toContainText(marker); await page.getByRole("button", { name: "返回问答", exact: true }).click(); await expect(workspace).toContainText("合成依据边界提示");
  await question.fill(`${prefix}未发送问题`); await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await confirm("取消"); await expect(question).toHaveValue(`${prefix}未发送问题`);
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await login(); await expect(question).toHaveValue(`${prefix}未发送问题`); await question.fill("");
  console.log("RAG done/save, source jump/return and unsent/auth draft preservation passed");

  await history(); const search = page.getByRole("textbox", { name: "搜索历史问答", exact: true }); await search.fill(`${prefix}更早问题独特词3`); await expect(page.locator(".rag-session-main")).toHaveCount(1); await expect(page.locator(".rag-session-main")).toContainText(seeded[3].title); await search.fill(""); await expect(page.locator(".rag-session-main")).toHaveCount(existingSessionCount + 23);
  await openSession(seeded[0]); await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
  await openSession(seeded[3]); await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5); await page.evaluate(() => window.scrollTo(0, 750)); assert.ok(await page.locator(".sidebar.qa-sidebar").evaluate(element => Math.abs(element.getBoundingClientRect().top) < 2));
  const windowTop = await page.evaluate(() => scrollY); await page.locator(".rag-history-groups").evaluate(element => { element.scrollTop = 180; }); assert.ok(await page.locator(".rag-history-groups").evaluate(element => element.scrollTop > 0)); assert.equal(await page.evaluate(() => scrollY), windowTop);
  await page.getByRole("button", { name: "折叠左侧栏", exact: true }).click(); await page.getByRole("button", { name: "最近问答", exact: true }).click(); const popover = page.locator(".rag-history-popover"); await expect(popover).toBeVisible();
  await expect.poll(() => popover.locator(".rag-session-item.active").evaluate(element => { const box = element.getBoundingClientRect(), list = element.closest(".rag-history-groups").getBoundingClientRect(); return box.top >= list.top - 1 && box.bottom <= Math.min(list.bottom, innerHeight) + 1; })).toBe(true);
  const recent = popover.locator(".rag-session-item.active .rag-session-main"); assert.ok(await recent.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }));
  await fs.mkdir(artifactRoot, { recursive: true }); await page.screenshot({ path: path.join(artifactRoot, "desktop-collapsed.png") }); await page.keyboard.press("Escape"); await history();
  const target = seeded[4]; await openSession(target); const row = () => page.locator(".rag-session-item").filter({ has: page.locator(".rag-session-main", { hasText: target.title }) });
  await row().getByRole("button", { name: `管理会话：${target.title}`, exact: true }).click(); await row().getByRole("button", { name: "重命名", exact: true }).click(); renameFailure = true; const rename = page.getByRole("textbox", { name: "会话标题", exact: true }); await rename.fill(`${prefix}已重命名`); await rename.press("Enter"); await expect(page.locator(".editor-navigation-status[role=alert]").filter({ visible: true })).toContainText("合成重命名失败"); await expect(rename).toHaveValue(`${prefix}已重命名`); await rename.press("Enter"); await expect(rename).toHaveCount(0); target.title = `${prefix}已重命名`; assert.equal((await get(target.id)).title, target.title);
  await row().getByRole("button", { name: `管理会话：${target.title}`, exact: true }).click(); await row().getByRole("button", { name: "删除", exact: true }).click(); await page.getByRole("dialog", { name: "确认删除会话", exact: true }).getByRole("button", { name: "取消", exact: true }).click(); assert.equal((await get(target.id)).title, target.title);
  await row().getByRole("button", { name: `管理会话：${target.title}`, exact: true }).click(); await row().getByRole("button", { name: "删除", exact: true }).click(); deleteMalformed = true; await page.getByRole("dialog", { name: "确认删除会话", exact: true }).getByRole("button", { name: "删除", exact: true }).click(); await expect(page.locator(".editor-navigation-status[role=alert]").filter({ visible: true })).toContainText("删除响应不完整"); await expect(row()).toHaveCount(1); await page.getByRole("dialog", { name: "确认删除会话", exact: true }).getByRole("button", { name: "删除", exact: true }).click(); await expect(row()).toHaveCount(0); owned.delete(target.id);
  console.log("RAG full-question history search, viewport sticky/collapsed hit testing, top opening and rename/delete failure preservation passed");

  await fresh(); streamMode = "eof"; const beforeEof = (await ownSessions()).length; await send("提前EOF"); await expect(workspace).toContainText("回答连接提前结束"); await expect(workspace).toContainText("合成流式片段"); assert.equal((await ownSessions()).length, beforeEof);
  await page.getByRole("button", { name: "新建问答", exact: true }).click(); await confirm("放弃并离开"); const stopped = hold(); await send("主动停止"); await stopped; await expect(workspace).toContainText("合成流式片段"); await page.getByRole("button", { name: "停止生成", exact: true }).click(); await expect(workspace).toContainText("生成已停止"); finishStream?.(); assert.equal((await ownSessions()).length, beforeEof);
  await page.getByRole("button", { name: "新建问答", exact: true }).click(); await confirm("放弃并离开"); streamMode = "done"; saveMode = "500"; await send("保存失败重试"); await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible(); await expect(workspace).toContainText("合成依据边界提示"); await page.getByRole("button", { name: "重试保存", exact: true }).click(); await expect(page.locator(".editor-navigation-status[role=alert]").filter({ visible: true })).toContainText("保存响应不完整"); await expect(workspace).toContainText("合成依据边界提示"); await page.getByRole("button", { name: "重试保存", exact: true }).click(); await expect(page.getByRole("button", { name: "重试保存", exact: true })).toHaveCount(0); assert.equal(savedRequests.length, 3); assert.deepEqual(savedRequests[0], savedRequests[1]); assert.deepEqual(savedRequests[1], savedRequests[2]); assert.equal((await ownSessions()).filter(session => session.id === savedRequests[0].id).length, 1);
  await fresh(); streamMode = "401"; await send("401保留问题"); await expect(page.getByLabel("访问密码")).toBeVisible(); streamMode = "done"; await login(); await expect(workspace).toContainText(`${prefix}401保留问题`);
  await page.getByRole("button", { name: "新建问答", exact: true }).click(); await confirm("放弃并离开"); const late = hold(); await send("迟到结果"); await late; await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await confirm("放弃并离开"); finishStream?.(); await center(); await expect(workspace.locator(".rag-message")).toHaveCount(0);
  console.log("RAG EOF/stop retain partial unsaved answers, stable save retry/malformed200, 401 and late response cancellation passed");

  await openSession(seeded[5]); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifactRoot, "desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await expect(question).toBeVisible(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(artifactRoot, "mobile.png") });
  await question.fill(`${prefix}手机问题`); await question.press("Shift+Enter"); await question.pressSequentially("换行保留"); await expect(question).toHaveValue(/\n换行保留$/); await question.fill(""); await history(); await expect(page.locator(".sidebar.mobile-open")).toBeVisible(); await expect.poll(() => page.locator(".sidebar.mobile-open").evaluate(element => Math.abs(element.getBoundingClientRect().left))).toBeLessThan(1); await expect.poll(() => page.locator(".sidebar.mobile-open .rag-session-item.active").evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })).toBe(true); await page.screenshot({ path: path.join(artifactRoot, "mobile-history.png") });
  await page.locator(".rag-session-main").filter({ hasText: seeded[6].title }).click(); await expect(page.locator(".sidebar.mobile-open")).toHaveCount(0); await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
  assert.deepEqual(errors, []); console.log("Passed: RAG desktop/mobile composition, Shift+Enter, history navigation, independent scrolling and modal cleanup");
} finally {
  finishStream?.();
  if (page) { await page.unrouteAll({ behavior: "ignoreErrors" }); for (const id of owned) { const response = await page.request.get(`${base}/api/rag/sessions/${id}`).catch(() => null); if (response?.ok()) { const session = (await response.json()).session; if (session.lastQuestion?.startsWith(prefix)) await page.request.delete(`${base}/api/rag/sessions/${id}`, { data: { mutationId: uuid(), baseVersion: session.version } }).catch(() => {}); } } }
  await browser.close(); mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve));
}

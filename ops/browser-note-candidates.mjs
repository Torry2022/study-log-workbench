import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local synthetic fixture required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const prefix = `验收候选B20-${Date.now()}`, tag = `${prefix}新标签`;
const materialText = "合成材料原文依据：独立字段能让资料引用和个人理解分别保存。";
const material = { name: "b20-synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(materialText) };
const browser = await chromium.launch();
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const section = page.getByRole("region", { name: "AI提取随记", exact: true });
  const candidate = index => section.getByRole("article", { name: `候选${index}`, exact: true });
  const first = candidate(1), second = candidate(2);
  const selectAllIsSingleLine = () => section.locator(".notes-ai-select-all").evaluate(element => { const node = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() === "全选"); if (!node) return false; const range = document.createRange(); range.selectNodeContents(node); return range.getClientRects().length === 1; });
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const confirm = async name => { await page.getByRole("alertdialog").getByRole("button", { name, exact: true }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0); };
  const center = async () => { await page.getByRole("button", { name: "随记", exact: true }).filter({ visible: true }).first().click(); await expect(page.getByLabel("搜索随记", { exact: true })).toBeVisible(); };
  const start = async () => { await page.getByRole("button", { name: "AI提取", exact: true }).filter({ visible: true }).first().click(); await expect(section).toBeVisible(); await section.getByLabel("提取随记材料文件", { exact: true }).setInputFiles(material); };
  const extract = async () => { await section.getByRole("button", { name: "提取随记", exact: true }).click(); await expect(first).toBeVisible(); };
  const ownNotes = async () => { const response = await page.request.get(`${base}/api/notes`); assert.equal(response.status(), 200); return (await response.json()).notes.filter(note => note.title.startsWith(prefix)); };
  let emptyResult = false, status = 200, pending = null, latestIds = [], calls = 0;
  // This permanent handler forbids paid model calls, including retries and late responses.
  await page.route("**/api/notes/candidates", async route => {
    calls++; const input = route.request().postDataJSON(); assert.equal(input.documents[0].fileName, material.name); assert.ok(input.documents[0].text.includes(materialText));
    latestIds = [1, 2].map(() => `b0200000-${randomUUID().slice(9)}`);
    const result = { model: "synthetic-candidates-mock", warnings: ["合成材料提取提示"], documents: [{ fileName: material.name, fileType: "text", size: material.buffer.length, sectionCount: 1 }], candidates: latestIds.map((id, index) => ({ id, kind: index ? "inferred" : "explicit", title: `${prefix}候选${index + 1}`, body: `合成候选正文${index + 1}`, insight: "", sources: ["普通材料来源"], tags: [tag], newTags: [tag], evidence: [{ sourceId: "doc1:s1", sourceLabel: "合成材料 · 第1段", quote: materialText }] })) };
    if (emptyResult) { result.candidates = []; result.warnings = []; }
    const response = status === 200 ? { status, json: { result } } : { status, json: { error: status === 401 ? "Unauthorized" : "合成提取失败，旧候选保留" } };
    if (pending) { const gate = pending; gate.started(); await gate.promise; }
    await route.fulfill(response).catch(() => {});
  });
  await page.route("**/api/capabilities", async route => { const response = await route.fetch(); const json = await response.json(); if (response.ok()) { json.features.aiNoteExtraction = { supported: true, configured: true }; json.aiConfiguration.provider = { configured: true, issues: [] }; json.aiConfiguration.templates.extraction = { configured: true }; } await route.fulfill({ response, json }); });
  function delayed() { let release, started; const promise = new Promise(resolve => release = resolve), seen = new Promise(resolve => started = resolve); pending = { promise, started }; return { seen, release: () => { release(); pending = null; } }; }
  let batchCalls = 0, savedSnapshot;
  await page.route("**/api/notes/batch", async route => {
    batchCalls++; const body = route.request().postDataJSON();
    if (batchCalls === 1) savedSnapshot = body; else assert.deepEqual(body, savedSnapshot, "An uncertain save must retry its unchanged payload");
    const response = await route.fetch(); assert.equal(response.status(), 200);
    if (batchCalls === 1) await route.abort("failed");
    else if (batchCalls === 2) await route.fulfill({ status: 200, json: {} });
    else await route.fulfill({ response });
  });
  await page.goto(base); await login(); await center(); await start();
  emptyResult = true;
  await section.getByRole("button", { name: "提取随记", exact: true }).click();
  await expect(section).toContainText("这次材料中没有适合保存为随记的内容。");
  await expect(section.locator(".notes-error")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "提取随记", exact: true })).toBeEnabled();
  await expect(section.getByLabel("提取随记材料文件", { exact: true })).toBeEnabled();
  emptyResult = false; await extract();
  await first.getByText("查看原文依据", { exact: true }).click(); await expect(first.locator("blockquote")).toBeVisible(); await expect(first.locator("blockquote")).toContainText(materialText); await expect(section).toContainText("合成材料提取提示");
  await first.getByLabel("标题", { exact: true }).fill(`${prefix}已编辑`); await first.getByLabel("正文", { exact: true }).fill("人工核对后的正文"); await first.getByLabel("个人理解", { exact: true }).fill("独立个人理解"); await first.getByLabel("来源", { exact: true }).fill("普通出处\nhttps://example.com/b20"); await first.getByLabel("标签", { exact: true }).fill(tag);
  await second.getByRole("checkbox").first().uncheck();
  await section.getByRole("button", { name: "保存选中项（1）", exact: true }).click(); await expect(section).toContainText("请先确认选中候选的新增标签"); assert.equal(batchCalls, 0);
  await first.getByLabel("确认新增标签", { exact: true }).check();
  const selectedId = latestIds[0], unselectedId = latestIds[1]; await section.getByRole("button", { name: "保存选中项（1）", exact: true }).click();
  await expect(section.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled(); await expect(first.getByLabel("正文", { exact: true })).toBeDisabled();
  const saved = await ownNotes(); assert.equal(saved.length, 1); assert.equal(saved[0].id, selectedId); assert.equal(saved[0].body, "人工核对后的正文"); assert.equal(saved[0].insight, "独立个人理解"); assert.deepEqual(saved[0].sources, ["普通出处", "https://example.com/b20"]); assert.equal(saved.some(note => note.id === unselectedId), false);
  await section.getByRole("button", { name: "重试保存", exact: true }).click(); await expect(section.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled(); await expect(first.getByLabel("正文", { exact: true })).toBeDisabled(); assert.equal((await ownNotes()).length, 1); assert.equal(batchCalls, 2);
  await section.getByRole("button", { name: "重试保存", exact: true }).click(); await expect(section).toHaveCount(0); assert.equal((await ownNotes()).length, 1); assert.equal(batchCalls, 3);
  console.log("Candidates: real material parsing, evidence, edits, selection/new-tag confirmation, uncertain-save freeze and idempotent retry passed");

  await start(); await extract(); await first.getByLabel("正文", { exact: true }).fill("未保存候选的人工修改");
  await page.getByRole("button", { name: "新建随记", exact: true }).filter({ visible: true }).first().click(); await confirm("取消"); await expect(first.getByLabel("正文", { exact: true })).toHaveValue("未保存候选的人工修改");
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await confirm("取消"); await expect(section).toBeVisible();
  let unloadSeen = false; page.once("dialog", async dialog => { unloadSeen = dialog.type() === "beforeunload"; await dialog.dismiss(); }); await page.reload({ timeout: 3000 }).catch(() => {}); assert.equal(unloadSeen, true); await expect(first.getByLabel("正文", { exact: true })).toHaveValue("未保存候选的人工修改");
  status = 502; await section.getByRole("button", { name: "重新提取", exact: true }).click(); await confirm("重新提取"); await expect(section).toContainText("合成提取失败"); await expect(first.getByLabel("正文", { exact: true })).toHaveValue("未保存候选的人工修改"); status = 200;
  const expired = delayed(); await section.getByRole("button", { name: "重新提取", exact: true }).click(); await confirm("重新提取"); await expired.seen; await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(page.getByLabel("访问密码")).toBeVisible(); expired.release(); await login(); await expect(first.getByLabel("正文", { exact: true })).toHaveValue("未保存候选的人工修改");
  status = 401; await section.getByRole("button", { name: "重新提取", exact: true }).click(); await confirm("重新提取"); await expect(page.getByLabel("访问密码")).toBeVisible(); status = 200; await login(); await expect(first.getByLabel("正文", { exact: true })).toHaveValue("未保存候选的人工修改"); await expect(section).not.toContainText("登录已过期，请重新登录");
  assert.ok(await selectAllIsSingleLine(), "Select-all label must stay on one line");
  await fs.mkdir(path.resolve("artifacts/note-candidates"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/note-candidates/desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.resolve("artifacts/note-candidates/mobile.png"), fullPage: true }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await selectAllIsSingleLine(), "Mobile select-all label must stay on one line");
  const trigger = page.getByRole("button", { name: "AI提取", exact: true }).filter({ visible: true }).first();
  assert.ok(await trigger.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect(), box = element.getBoundingClientRect(); return text.width === 0 || text.right <= box.right + 1; }), "Mobile extraction button content must fit its border");
  await first.getByLabel("个人理解", { exact: true }).fill("手机可编辑个人理解"); await expect(first.getByLabel("个人理解", { exact: true })).toHaveValue("手机可编辑个人理解");
  const mobileSave = section.getByRole("button", { name: "保存选中项（2）", exact: true }); await mobileSave.scrollIntoViewIfNeeded();
  assert.ok(await mobileSave.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), "Mobile save action must remain reachable above fixed navigation");
  await page.screenshot({ path: path.resolve("artifacts/note-candidates/mobile-actions.png") });
  await page.setViewportSize({ width: 1440, height: 1000 }); const late = delayed(); await section.getByRole("button", { name: "重新提取", exact: true }).click(); await confirm("重新提取"); await late.seen; await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await confirm("放弃提取"); late.release(); await expect(section).toHaveCount(0); await center(); await expect(section).toHaveCount(0);
  await start(); await extract(); await page.getByRole("button", { name: "新建随记", exact: true }).filter({ visible: true }).first().click(); await confirm("放弃提取"); await expect(section).toHaveCount(0); await expect(page.locator(".notes-composer")).toBeVisible(); assert.equal((await ownNotes()).length, 1);
  assert.ok(calls >= 6); assert.deepEqual(errors, []); console.log("Passed: candidates new-note/module/refresh guards, failed re-extraction, 401 draft retention, stale responses, confirmed discard and mobile layout");
} finally { await page?.unrouteAll({ behavior: "ignoreErrors" }); await browser.close(); }

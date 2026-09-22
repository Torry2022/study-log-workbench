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
const prefix = "验收随记", date = "2026-09-11";
const image = { name: "notes-fixture.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#cc785c"/></svg>') };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => { errors.push(error.message); console.log("Page error", error.message); });
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const snapshot = async () => (await (await page.request.get(`${base}/api/notes`)).json()).notes;
  const ownNotes = async () => (await snapshot()).filter(note => note.title.startsWith(prefix));
  const create = async data => { const response = await page.request.post(`${base}/api/notes`, { data: { body: "合成记录", insight: "独立理解", sources: ["普通资料来源"], tags: ["验收标签"], recordedAt: "2026-08-11T12:00", ...data } }); assert.equal(response.status(), 200, await response.text()); return (await response.json()).note; };
  const center = async () => { await page.getByRole("button", { name: "随记", exact: true }).filter({ visible: true }).first().click(); await expect(page.getByLabel("搜索随记", { exact: true })).toBeVisible(); };
  const cards = page.locator(".note-entry").filter({ has: page.getByRole("heading", { name: /^验收随记/ }) });
  const body = page.getByLabel("随记正文", { exact: true }), insight = page.getByLabel("个人理解", { exact: true });
  const editor = page.locator(".notes-composer");
  const card = title => cards.filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  const edit = async title => { await card(title).getByRole("button", { name: "编辑", exact: true }).click(); await expect(editor).toBeVisible(); };
  const start = async () => { await page.getByRole("button", { name: "新建随记", exact: true }).filter({ visible: true }).first().click(); await expect(editor).toBeVisible(); };
  const confirm = async (label = "放弃") => { await page.getByRole("alertdialog").getByRole("button", { name: label, exact: true }).click().catch(async error => { console.log("Confirm diagnostic", page.url(), await page.locator("main").innerText().catch(() => ""), await page.getByRole("alertdialog").allTextContents()); throw error; }); await expect(page.getByRole("alertdialog")).toHaveCount(0); };
  const discard = async () => { await page.getByRole("button", { name: "返回随记列表", exact: true }).click(); if (await page.getByRole("alertdialog").count()) await confirm(); await expect(editor).toHaveCount(0); };
  const save = async () => { await page.getByRole("button", { name: "保存随记", exact: true }).click(); await expect(editor).toHaveCount(0); };
  const delayed = async (url, method = "POST") => {
    let release, started, finished, intercepted = false;
    const gate = new Promise(resolve => release = resolve), seen = new Promise(resolve => started = resolve), done = new Promise(resolve => finished = resolve);
    const handler = async route => { if (intercepted || route.request().method() !== method) return route.continue(); intercepted = true; const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => {}); finished(); };
    await page.route(url, handler);
    return { seen: () => Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error(`No delayed ${method} ${url}`)), 15000).unref())]), release: async () => { release(); await done; await page.unroute(url, handler); } };
  };
  await page.goto(base); await login();
  for (const note of await ownNotes()) assert.equal((await page.request.delete(`${base}/api/notes`, { data: { id: note.id, baseVersion: note.version } })).status(), 200);
  const { day } = await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json();
  assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: "### 随记内链验收\n\n独立合成来源日志。", baseVersion: day.version } })).status(), 200);
  await create({ title: `${prefix}旧年`, recordedAt: "2025-08-11T12:00", tags: ["旧年标签"] });
  await create({ title: `${prefix}来源`, body: `记录正文与 [[${date}#随记内链验收|合成日志来源]]。`, sources: ["普通资料来源", "https://example.com/reference"], tags: ["验收标签", "内链标签"] });
  await center(); await expect(cards).toHaveCount(2);
  await start(); await page.getByPlaceholder("标题（可选，留空时显示正文首句）").fill(`${prefix}编辑`); await page.getByLabel("记录时间", { exact: true }).fill("2026-08-12T14:30"); await body.fill("正文独立字段"); await insight.fill("个人理解独立字段"); await page.getByLabel("来源", { exact: true }).fill("普通来源\nhttps://example.com");
  await page.getByRole("combobox", { name: "搜索或创建标签" }).fill("新建标签"); await page.getByRole("combobox", { name: "搜索或创建标签" }).press("Enter");
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await confirm("取消"); await expect(body).toHaveValue("正文独立字段");
  await page.getByRole("button", { name: "刷新随记", exact: true }).click(); await expect(body).toHaveValue("正文独立字段");
  let unloadSeen = false; page.once("dialog", async dialog => { unloadSeen = dialog.type() === "beforeunload"; await dialog.dismiss(); }); await page.reload({ timeout: 3000 }).catch(() => {}); assert.equal(unloadSeen, true); await expect(body).toHaveValue("正文独立字段");
  await save(); let saved = (await ownNotes()).find(note => note.title === `${prefix}编辑`); assert.equal(saved.insight, "个人理解独立字段"); assert.deepEqual(saved.tags, ["新建标签"]); assert.deepEqual(saved.sources, ["普通来源", "https://example.com"]);
  await expect(card(`${prefix}编辑`)).toContainText("个人理解独立字段");
  await page.getByLabel("搜索随记", { exact: true }).fill("普通资料来源"); await page.getByRole("button", { name: "搜索随记内容", exact: true }).click(); await expect(cards).toHaveCount(2);
  await page.locator(".notes-filter-list").getByRole("button", { name: /^2025/ }).click(); await expect(cards).toHaveCount(1); await expect(cards).toContainText(`${prefix}旧年`);
  await page.locator(".notes-filter-list").getByRole("button", { name: /^全部/ }).click(); await page.locator(".notes-tag-filter-list").getByRole("button", { name: /^内链标签/ }).click(); await expect(cards).toHaveCount(1);
  await card(`${prefix}来源`).getByRole("link", { name: "合成日志来源", exact: true }).click(); await expect(page).toHaveURL(/date=2026-09-11/); await page.getByRole("button", { name: "返回随记", exact: true }).click(); await expect(cards).toHaveCount(1); await expect(page.getByLabel("搜索随记", { exact: true })).toHaveValue("普通资料来源"); await expect(page.locator(".notes-tag-filter-list .active")).toContainText("内链标签");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click(); await page.getByRole("button", { name: "清空随记搜索", exact: true }).click();
  console.log("Notes CRUD fields, tag picker, filters, dirty navigation/refresh and source return passed");

  // A save finishing after further typing promotes the version without closing the editor.
  await edit(`${prefix}编辑`); await body.fill("保存中的版本"); const saving = await delayed("**/api/notes", "PATCH"); await page.getByRole("button", { name: "保存随记", exact: true }).click(); await saving.seen(); await body.fill("保存后继续输入"); await saving.release(); await expect(body).toHaveValue("保存后继续输入"); await expect(page.getByRole("button", { name: "保存随记", exact: true })).toBeEnabled().catch(async error => { console.log("Save diagnostic", await page.locator(".notes-error").allTextContents()); throw error; }); await save(); assert.equal((await ownNotes()).find(note => note.id === saved.id).body, "保存后继续输入");
  await edit(`${prefix}编辑`); await body.fill("冲突本地草稿"); saved = (await ownNotes()).find(note => note.id === saved.id); assert.equal((await page.request.patch(`${base}/api/notes`, { data: { ...saved, body: "另一窗口写入", baseVersion: saved.version } })).status(), 200);
  await page.getByRole("button", { name: "保存随记", exact: true }).click(); await expect(page.getByRole("button", { name: "重新读取服务器版本", exact: true })).toBeVisible(); await expect(body).toHaveValue("冲突本地草稿"); await expect(page.getByRole("button", { name: "保存随记", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重新读取服务器版本", exact: true }).click(); await confirm("取消"); await expect(body).toHaveValue("冲突本地草稿"); await page.getByRole("button", { name: "重新读取服务器版本", exact: true }).click(); await confirm(); await expect(body).toHaveValue("另一窗口写入"); await discard();
  await edit(`${prefix}编辑`); await body.fill("失败与登录过期保留草稿");
  await page.route("**/api/notes", route => route.request().method() === "PATCH" ? route.fulfill({ status: 500, json: { error: "合成保存失败" } }) : route.continue()); await page.getByRole("button", { name: "保存随记", exact: true }).click(); await expect(page.locator(".notes-error")).toContainText("合成保存失败"); await expect(body).toHaveValue("失败与登录过期保留草稿"); await page.unroute("**/api/notes");
  await page.route("**/api/notes", route => route.request().method() === "GET" ? route.fulfill({ status: 401, json: { error: "Unauthorized" } }) : route.continue()); await page.getByRole("button", { name: "刷新随记", exact: true }).click(); await expect(page.getByLabel("访问密码")).toBeVisible(); await page.unroute("**/api/notes"); await login(); await expect(body).toHaveValue("失败与登录过期保留草稿"); await discard();
  console.log("Notes save-while-typing, conflict, failure and authentication draft retention passed");

  // Upload stays attached to its original field and maps its selection through typing.
  await edit(`${prefix}编辑`); await body.fill("上传原位置"); await body.press("End"); const upload = await delayed("**/api/assets/upload"); await page.locator('.notes-composer input[type="file"]').setInputFiles(image); await upload.seen(); await body.press("End"); await body.pressSequentially("继续写"); await insight.fill("切换到心得后继续写"); await upload.release(); await expect(body).toHaveValue(/上传原位置继续写\n!\[.*assets\/notes\/2026/); await expect(insight).toHaveValue("切换到心得后继续写");
  await insight.focus(); await insight.press("End"); await page.locator('.notes-composer input[type="file"]').setInputFiles(image); await expect(insight).toHaveValue(/切换到心得后继续写\n!\[.*assets\/notes\/2026/); await save(); await expect(card(`${prefix}编辑`).locator("img")).toHaveCount(2);
  // Abandoned upload cannot enter the next draft, even when its response arrives late.
  await edit(`${prefix}编辑`); await body.fill("准备放弃上传"); const abandoned = await delayed("**/api/assets/upload"); await page.locator('.notes-composer input[type="file"]').setInputFiles(image); await abandoned.seen(); await page.getByRole("button", { name: "返回随记列表", exact: true }).click(); await confirm("取消"); await expect(body).toHaveValue("准备放弃上传"); await page.getByRole("button", { name: "返回随记列表", exact: true }).click(); await confirm(); await start(); await body.fill("新草稿不收旧图片"); await abandoned.release(); await expect(body).toHaveValue("新草稿不收旧图片"); await discard();
  await edit(`${prefix}编辑`); await body.fill("上传过期草稿"); const expired = await delayed("**/api/assets/upload"); await page.locator('.notes-composer input[type="file"]').setInputFiles(image); await expired.seen(); await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(page.getByLabel("访问密码")).toBeVisible(); await expired.release(); await login(); await expect(body).toHaveValue("上传过期草稿"); await discard();
  console.log("Notes image field identity, mapped selection, cancel/late response and auth expiration passed");

  await card(`${prefix}旧年`).getByRole("button", { name: `删除随记：${prefix}旧年`, exact: true }).click(); await confirm("取消"); await expect(card(`${prefix}旧年`)).toBeVisible();
  await page.route("**/api/notes", route => route.request().method() === "DELETE" ? route.fulfill({ status: 500, json: { error: "合成删除失败" } }) : route.continue()); await card(`${prefix}旧年`).getByRole("button", { name: `删除随记：${prefix}旧年`, exact: true }).click(); await confirm("删除"); await expect(page.locator(".notes-error")).toContainText("合成删除失败"); await expect(card(`${prefix}旧年`)).toBeVisible(); await page.unroute("**/api/notes");
  await card(`${prefix}旧年`).getByRole("button", { name: `删除随记：${prefix}旧年`, exact: true }).click(); await confirm("删除"); await expect(card(`${prefix}旧年`)).toHaveCount(0);
  // A failed refresh keeps saved items; a stale GET cannot replace a newer mutation.
  await page.route("**/api/notes", route => route.request().method() === "GET" ? route.fulfill({ status: 500, json: { error: "合成读取失败" } }) : route.continue());
  await page.getByRole("button", { name: "刷新随记", exact: true }).click(); await expect(page.locator(".notes-error")).toContainText("合成读取失败"); await expect(card(`${prefix}编辑`)).toBeVisible(); await page.unroute("**/api/notes"); await page.getByRole("button", { name: "重试", exact: true }).click(); await expect(page.locator(".notes-error")).toHaveCount(0);
  const stale = await delayed("**/api/notes", "GET"); await page.getByRole("button", { name: "刷新随记", exact: true }).click(); await stale.seen(); await edit(`${prefix}编辑`); await page.getByPlaceholder("标题（可选，留空时显示正文首句）").fill(`${prefix}编辑迟到保护`); await save(); await stale.release(); await expect(card(`${prefix}编辑迟到保护`)).toBeVisible(); await edit(`${prefix}编辑迟到保护`); await page.getByPlaceholder("标题（可选，留空时显示正文首句）").fill(`${prefix}编辑`); await save();
  await fs.mkdir(path.resolve("artifacts/notes"), { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.resolve("artifacts/notes/desktop.png") });
  await edit(`${prefix}编辑`); await page.screenshot({ path: path.resolve("artifacts/notes/desktop-editor.png") }); await discard();
  await page.goto(`${base}?view=notes&note=${saved.id}`); await expect(card(`${prefix}编辑`)).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.resolve("artifacts/notes/mobile.png") }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await start(); await body.fill("手机随记正文"); await insight.fill("手机心得"); await page.screenshot({ path: path.resolve("artifacts/notes/mobile-editor.png") }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await discard();
  await card(`${prefix}编辑`).getByLabel(`更多随记操作：${prefix}编辑`, { exact: true }).click(); await card(`${prefix}编辑`).getByRole("button", { name: "删除随记", exact: true }).click(); await confirm("取消");
  assert.deepEqual(errors, []); console.log("Passed: notes desktop/mobile layout, deep link focus and mobile delete cancellation");
} finally { await browser.close(); }

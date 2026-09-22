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
const dates = ["2026-07-11", "2026-07-12", "2026-07-13"];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const snapshot = async () => (await (await page.request.get(`${base}/api/favorites`)).json());
  const save = async (date, content) => {
    const { day } = await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json();
    const response = await page.request.put(`${base}/api/logs/day`, { data: { date, content, baseVersion: day.version } }); assert.equal(response.status(), 200);
  };
  const center = async () => { await page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true }).first().click(); await expect(page.getByLabel("搜索收藏", { exact: true })).toBeVisible(); };
  const cards = page.locator(".favorite-item-center");
  const groupDialog = page.getByRole("dialog", { name: "选择分组", exact: true });
  const openGroup = async title => { await page.getByRole("button", { name: `选择 ${title} 的收藏分组`, exact: true }).click(); await expect(groupDialog).toBeVisible(); };
  const closeGroup = async () => { await groupDialog.getByRole("button", { name: "完成", exact: true }).click(); await expect(groupDialog).not.toBeVisible(); };
  const filterAll = async () => { await page.locator(".favorite-navigation-list").getByRole("button", { name: /^全部收藏/ }).click(); };
  await page.goto(base); await login();
  // Only records owned by this synthetic scenario are reset; no real instance is contacted.
  const before = await snapshot();
  for (const item of before.favorites.filter(item => dates.includes(item.date))) assert.equal((await page.request.delete(`${base}/api/favorites?id=${item.id}`)).status(), 200);
  for (const group of before.groups.filter(group => group.name.startsWith("验收组"))) assert.equal((await page.request.delete(`${base}/api/favorites?groupId=${group.id}`)).status(), 200);
  await save(dates[0], "### 收藏验收HTTP\n\n网络 API 和 AbortController 正文。\n\n#### 子标题不可整段收藏");
  await save(dates[1], "### 收藏验收Beta\n\n第二条知识。标题保持有效。");
  await save(dates[2], "### 收藏验收Gamma\n\n第三条知识。");
  for (const [date, headingText, headingId] of [[dates[1], "收藏验收Beta", "收藏验收beta"], [dates[2], "收藏验收Gamma", "收藏验收gamma"]]) assert.equal((await page.request.post(`${base}/api/favorites`, { data: { date, headingText, headingId, level: 3 } })).status(), 200);
  await page.goto(`${base}?date=${dates[0]}`);
  await page.getByRole("button", { name: /收藏.*收藏验收HTTP/ }).filter({ visible: true }).first().click();
  await expect.poll(async () => (await snapshot()).favorites.filter(item => item.date === dates[0]).length).toBe(1);
  await expect(page.locator(".favorite-success-notice")).toBeVisible();
  await page.locator(".favorite-success-notice").getByRole("button", { name: "选择分组", exact: true }).click(); await expect(groupDialog).toBeVisible(); await closeGroup();
  await page.getByRole("button", { name: "取消收藏：收藏验收HTTP", exact: true }).filter({ visible: true }).first().click();
  await page.getByRole("dialog", { name: /^确认取消收藏/ }).getByRole("button", { name: "保留", exact: true }).click();
  await center(); await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText("收藏验收Gamma");
  await page.getByLabel("收藏排序方式").selectOption("saved-date"); await expect(cards.first()).toContainText("收藏验收HTTP");
  await page.getByLabel("收藏排序方式").selectOption("log-date");

  // Create-and-assign uses the authoritative returned group, then supports rename/delete.
  await openGroup("收藏验收HTTP"); await groupDialog.getByLabel("新建收藏分组名称").fill("验收组网络"); await groupDialog.getByRole("button", { name: "创建并加入", exact: true }).click();
  await expect(groupDialog.getByRole("checkbox")).toBeChecked(); await closeGroup(); await expect(cards.filter({ hasText: "收藏验收HTTP" })).toContainText("验收组网络");
  await page.getByRole("button", { name: "管理分组 验收组网络", exact: true }).click(); await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("重命名分组").fill("验收组协议"); await page.locator(".favorite-group-rename").getByRole("button", { name: "保存", exact: true }).click(); await expect(page.getByRole("button", { name: "管理分组 验收组协议", exact: true })).toBeVisible();
  await page.locator(".favorite-filter-chip.compound").getByRole("button", { name: /^验收组协议/ }).click(); await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "管理分组 验收组协议", exact: true }).click(); await page.getByRole("button", { name: "删除分组", exact: true }).click(); await page.locator(".favorite-group-delete-confirm").getByRole("button", { name: "保留", exact: true }).click();
  await page.getByRole("button", { name: "管理分组 验收组协议", exact: true }).click(); await page.getByRole("button", { name: "删除分组", exact: true }).click(); await page.locator(".favorite-group-delete-confirm").getByRole("button", { name: "删除", exact: true }).click();
  await expect(cards).toHaveCount(3); assert.equal((await snapshot()).favorites.length, 3);

  // Content search, case and H3-only switches, both presentation modes.
  await page.getByLabel("搜索收藏", { exact: true }).fill("abortcontroller"); await page.getByRole("button", { name: "搜索收藏内容", exact: true }).click(); await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "收藏搜索区分大小写", exact: true }).click(); await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "收藏搜索区分大小写", exact: true }).click(); await page.getByRole("button", { name: "仅搜索收藏小节标题", exact: true }).click(); await expect(cards).toHaveCount(0);
  await page.getByRole("button", { name: "清空收藏搜索", exact: true }).click(); await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "卡片视图", exact: true }).filter({ visible: true }).click(); await expect(page.locator(".favorites-month-list.grid")).toHaveCount(1);
  await page.getByRole("button", { name: "列表视图", exact: true }).filter({ visible: true }).click();
  await cards.filter({ hasText: "收藏验收HTTP" }).locator(".favorite-item-main").click(); await expect(page).toHaveURL(/date=2026-07-11/); await expect(page.locator(".markdown-preview h3").filter({ hasText: "收藏验收HTTP" })).toBeVisible();

  // Re-resolve against saved content, retaining a missing favorite instead of dropping it.
  await save(dates[1], "### 标题已经改名\n\n收藏应标记失效。"); await page.reload(); await center(); await expect(cards.filter({ hasText: "收藏验收Beta" })).toContainText("未找到");
  await cards.filter({ hasText: "收藏验收Beta" }).locator(".favorite-item-main").click(); await expect(page).toHaveURL(/date=2026-07-12/); await expect(page.getByText("原收藏小节未找到，已打开所属日期。", { exact: true })).toBeVisible(); await center();
  await page.getByRole("button", { name: "取消收藏 收藏验收Beta", exact: true }).click(); await page.getByRole("dialog", { name: /^确认取消收藏/ }).getByRole("button", { name: "保留", exact: true }).click(); await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "取消收藏 收藏验收Beta", exact: true }).click(); await page.getByRole("dialog", { name: /^确认取消收藏/ }).getByRole("button", { name: "确认", exact: true }).click(); await expect(cards).toHaveCount(2);
  await fs.mkdir(path.resolve("artifacts/favorites"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/favorites/desktop.png") });
  console.log("Favorites: H3 add, groups, sorting, search, source navigation, missing source and removal passed");

  // Failed writes must preserve both existing favorite and the visible retryable error.
  await page.route("**/api/favorites?id=*", route => route.request().method() === "DELETE" ? route.fulfill({ status: 500, json: { error: "合成取消收藏失败" } }) : route.continue());
  await page.getByRole("button", { name: "取消收藏 收藏验收HTTP", exact: true }).click(); await page.getByRole("dialog", { name: /^确认取消收藏/ }).getByRole("button", { name: "确认", exact: true }).click(); await expect(page.locator(".favorites-view")).toContainText("合成取消收藏失败"); await expect(cards).toHaveCount(2);
  await page.unroute("**/api/favorites?id=*"); await page.getByRole("dialog", { name: /^确认取消收藏/ }).getByRole("button", { name: "保留", exact: true }).click();
  await page.locator(".favorites-view").getByRole("button", { name: "重试", exact: true }).click(); await expect(page.locator(".favorites-error")).toHaveCount(0);

  // Failed refresh retains the previous snapshot; a real 401 hides it until re-login.
  let readStatus = 500;
  await page.route("**/api/favorites", route => route.request().method() === "GET" ? route.fulfill({ status: readStatus, json: { error: readStatus === 401 ? "Unauthorized" : "合成收藏读取失败" } }) : route.continue());
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await login(); await center();
  await expect(page.locator(".favorites-view")).toContainText("合成收藏读取失败"); await expect(cards).toHaveCount(2);
  readStatus = 401; await page.locator(".favorites-view").getByRole("button", { name: "重试", exact: true }).click(); await expect(page.getByLabel("访问密码")).toBeVisible();
  await page.unroute("**/api/favorites"); await login(); await center(); await expect(cards).toHaveCount(2);

  // A delayed old GET cannot overwrite a successful group write's fresh snapshot.
  let release, started, intercepted = false;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  await page.route("**/api/favorites", async route => {
    if (route.request().method() !== "GET" || intercepted) return route.continue();
    intercepted = true; const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => {});
  });
  await center(); await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("Delayed favorites read did not start")), 15_000))]);
  await openGroup("收藏验收HTTP"); await groupDialog.getByLabel("新建收藏分组名称").fill("验收组迟到保护"); await groupDialog.getByRole("button", { name: "创建并加入", exact: true }).click(); await expect(groupDialog.getByRole("checkbox")).toBeChecked();
  release(); await page.unroute("**/api/favorites"); await expect(groupDialog).toContainText("验收组迟到保护"); await closeGroup();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(cards).toHaveCount(2); await openGroup("收藏验收HTTP");
  await page.screenshot({ path: path.resolve("artifacts/favorites/mobile-group.png") });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(groupDialog).not.toBeVisible(); await login(); assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
  await center(); await page.screenshot({ path: path.resolve("artifacts/favorites/mobile.png") });
  assert.deepEqual(errors, []); console.log("Passed: favorites mutation failure preserves data, late read cannot overwrite mutation, mobile layout and dialog expiration cleanup");
} finally { await browser.close(); }

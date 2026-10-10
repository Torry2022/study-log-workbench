import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3563/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw Error("Explicit synthetic instance and loopback URL required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
const alpha = "合成统计 Alpha", beta = "合成统计 Beta", domain = "合成统计验证";
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${base}?view=stats&month=2026-08`);
  await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  for (const [date, content] of [["2026-08-05", `### 1. ${alpha}\n\n合成统计资料一\n\n### 2. ${beta}\n\n合成统计资料二`], ["2026-08-06", `### 1. ${alpha}\n\n合成统计资料三`]]) {
    const current = await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json();
    assert.ok(!current.day.exists || current.day.content.includes("合成统计资料"), "August fixture must not overwrite unrelated synthetic work");
    const response = await page.request.put(`${base}/api/logs/day`, { data: { date, content, baseVersion: current.day.version } });
    assert.equal(response.status(), 200);
  }
  // Existing manual classifications remain usable without a model; a new empty
  // classification is now AI-led instead of asking users to build a taxonomy.
  const taxonomy = (await (await page.request.get(`${base}/api/taxonomy`)).json()).taxonomy;
  if (!taxonomy.domains.some(item => item !== "其他")) {
    const seeded = await page.request.put(`${base}/api/taxonomy`, { data: {
      domains: [domain, "其他"], mappings: {}, baseVersion: taxonomy.version
    } });
    assert.equal(seeded.status(), 200);
  }
  await page.reload();
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-08");
  await expect(page.locator(".stats-metric-strip > div").nth(0).locator("strong")).toHaveText("2");
  await expect(page.locator(".stats-metric-strip > div").nth(1).locator("strong")).toHaveText("3");
  await page.getByTitle("2026-08-05：2 个日志小节", { exact: true }).click();
  await expect(page.locator(".stats-calendar-drilldown .stats-drilldown-list > button")).toHaveCount(2);
  await page.locator(".stats-calendar-drilldown .stats-drilldown-list > button").filter({ hasText: beta }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log");
  assert.equal(new URL(page.url()).searchParams.get("date"), "2026-08-05");
  await page.goBack();
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-08");
  await page.locator(".stats-review-actions").getByRole("button", { name: "分类管理", exact: true }).click();
  await expect(page.locator(".taxonomy-manager")).toBeVisible();
  assert.equal(await page.getByRole("button", { name: /AI 自动分类/ }).count(), 0);
  if (await page.locator(".taxonomy-domain-chip").filter({ hasText: domain }).count() === 0) {
    await page.getByPlaceholder("新增自定义领域").fill(domain);
    await page.locator(".taxonomy-domain-form").getByRole("button", { name: "添加", exact: true }).click();
  }
  await page.getByLabel(`领域 ${alpha}`, { exact: true }).selectOption(domain);
  await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await expect(page.locator(".stats-feedback")).toContainText("领域映射已保存");
  assert.equal((await (await page.request.get(`${base}/api/taxonomy`)).json()).taxonomy.mappings[alpha], domain);
  await page.getByRole("button", { name: "月度复盘", exact: true }).click();
  await page.locator(".stats-topic-ranking > button").filter({ hasText: alpha }).click();
  await expect(page.locator(".stats-drilldown-list > button")).toHaveCount(2);
  const segment = page.locator(".stats-donut svg").getByRole("button", { name: new RegExp(domain) });
  await segment.scrollIntoViewIfNeeded();
  const point = await segment.evaluate(node => {
    const local = node.getPointAtLength(node.getTotalLength() / 2);
    const screen = new DOMPoint(local.x, local.y).matrixTransform(node.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".stats-drilldown-list > button")).toHaveCount(2);
  await page.locator(".stats-review-actions").getByRole("button", { name: "分类管理", exact: true }).click();

  // An independent editor changes the same taxonomy snapshot while this UI holds a draft.
  await page.getByLabel(`领域 ${beta}`, { exact: true }).selectOption(domain);
  const external = (await (await page.request.get(`${base}/api/taxonomy`)).json()).taxonomy;
  const update = await page.request.put(`${base}/api/taxonomy`, { data: {
    domains: [...external.domains, "合成外部更新"], mappings: external.mappings, baseVersion: external.version
  } });
  assert.equal(update.status(), 200);
  await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await expect(page.locator(".stats-feedback.error")).toContainText("分类已被其他操作修改");
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(domain);
  await expect(page.locator(".stats-draft-status")).toBeVisible();
  const confirm = async accept => {
    const dialog = page.getByRole("alertdialog"); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: accept ? "放弃修改" : "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await page.getByRole("button", { name: "重新读取分类", exact: true }).click(); await confirm(false);
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(domain);
  await page.getByRole("button", { name: "重新读取分类", exact: true }).click(); await confirm(true);
  await expect(page.locator(".taxonomy-domain-chip").filter({ hasText: "合成外部更新" })).toBeVisible();
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(external.mappings[beta] || "其他");

  // Root module navigation and authentication expiry preserve/guard drafts.
  await page.getByLabel(`领域 ${beta}`, { exact: true }).selectOption(domain);
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click(); await confirm(false);
  await expect(page.locator(".taxonomy-manager")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired")));
  await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(domain);
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click(); await confirm(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log");
  await page.getByRole("button", { name: "统计", exact: true }).filter({ visible: true }).click();
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(external.mappings[beta] || "其他");
  await page.getByRole("button", { name: "月度复盘", exact: true }).click();

  // A late response for August must not replace a newer empty-month result.
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await page.route("**/api/stats?month=2026-08", async route => {
    const response = await route.fetch(); started(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator(".stats-review-actions").getByRole("button", { name: "刷新", exact: true }).click();
  await requested;
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set("view", "stats"); url.searchParams.set("month", "2026-07");
    history.pushState({ studyLogIndex: (history.state?.studyLogIndex || 0) + 1 }, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-07");
  await expect(page.locator(".stats-metric-strip > div").nth(1).locator("strong")).toHaveText("0");
  release(); await page.unroute("**/api/stats?month=2026-08");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-07");
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log");
  await page.goBack();
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-07");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log");
  await page.getByRole("button", { name: "统计", exact: true }).filter({ visible: true }).click();
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-07");
  await page.goto(`${base}?view=stats&month=2026-08`);
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-08");
  await page.route("**/api/stats?month=2026-08", route => route.abort("failed"));
  await page.locator(".stats-review-actions").getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.locator(".stats-workspace .workspace-state-error")).toBeVisible();
  await page.unroute("**/api/stats?month=2026-08");
  await page.locator(".stats-workspace .workspace-state-error").getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".stats-review-toolbar h2")).toHaveText("2026-08");

  const artifacts = path.join(root, "artifacts"); await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "stats-desktop.png"), fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
  const phone = await mobile.newPage(); await phone.goto(`${base}?view=stats&month=2026-08`);
  await expect(phone.locator(".stats-review-toolbar h2")).toHaveText("2026-08");
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.getByTitle("2026-08-05：2 个日志小节", { exact: true }).click();
  await expect(phone.locator(".stats-calendar-drilldown .stats-drilldown-list > button")).toHaveCount(2);
  await phone.screenshot({ path: path.join(artifacts, "stats-mobile.png"), fullPage: true });
  await phone.locator(".stats-review-actions").getByRole("button", { name: "分类管理", exact: true }).click();
  await expect(phone.getByLabel(`领域 ${alpha}`, { exact: true })).toBeVisible();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.screenshot({ path: path.join(artifacts, "stats-taxonomy-mobile.png"), fullPage: true });
  console.log("Passed: exact August metrics, day/tag/domain drilldown, source navigation, custom mapping persistence, 409 draft retention, discard guard, auth expiry retention, stale month cancellation, empty month, network retry, desktop/mobile layout");
} finally { await browser.close(); }

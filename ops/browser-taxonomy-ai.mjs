import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw Error("Explicit synthetic instance and loopback URL required");
const environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const alpha = "合成分类 Alpha", beta = "合成分类 Beta", domainA = "合成领域甲", domainB = "合成领域乙";
let saved = { domains: [domainA, domainB, "其他"], mappings: {}, updatedAt: null, version: "synthetic-v1" };
let configured = false, requestCount = 0, saveCount = 0, expireSave = false, behavior = "success", release, started;
function waitForSuggestionStart() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Suggestion request not intercepted within 15s (requests=${requestCount}, behavior=${behavior})`)), 15000);
    started = () => { clearTimeout(timer); resolve(); };
  });
}
const suggestions = () => [{ tag: alpha, domain: domainA, confidence: "high" }, { tag: beta, domain: domainB, confidence: "medium" }];
const catalog = () => [alpha, beta].map(tag => ({ tag, count: 1, domain: saved.mappings[tag] || "其他", explicitlyMapped: Object.hasOwn(saved.mappings, tag), sources: [tag], months: ["2026-08"] }));
async function installMocks(context) {
  // Navigation must not rely on months left by a previous browser workflow.
  await context.route("**/api/logs/months", route => route.fulfill({ json: {
    months: ["2026-08", "2026-07"].map(id => ({ id, label: id, dayCount: 0, firstDate: null, lastDate: null }))
  } }));
  await context.route("**/api/capabilities", async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.features.aiTaxonomy = { supported: true, configured };
    payload.aiConfiguration.provider = { configured, issues: configured ? [] : [{ field: "CHAT_MODEL", reason: "missing", message: "请配置 CHAT_MODEL" }] };
    await route.fulfill({ response, json: payload });
  });
  await context.route("**/api/taxonomy", async route => {
    if (route.request().method() === "PUT") {
      saveCount++;
      if (expireSave) { expireSave = false; await route.fulfill({ status: 401, json: { error: "Unauthorized" } }); return; }
      const body = route.request().postDataJSON();
      if (body.baseVersion !== saved.version) { await route.fulfill({ status: 409, json: { error: "分类已被其他操作修改", code: "TAXONOMY_CONFLICT" } }); return; }
      saved = { domains: body.domains, mappings: body.mappings, version: `synthetic-save-${saveCount}`, updatedAt: "2026-08-01T00:00:00.000Z" };
      await route.fulfill({ json: { taxonomy: saved } }); return;
    }
    await route.fulfill({ json: { taxonomy: saved, catalog: catalog() } });
  });
  await context.route("**/api/taxonomy/suggest", async route => {
    requestCount++;
    const snapshotVersion = saved.version;
    if (behavior === "failure") { await route.fulfill({ status: 502, json: { error: "合成分类服务失败" } }); return; }
    if (behavior === "delay") { started?.(); await new Promise(resolve => { release = resolve; }); }
    await route.fulfill({ json: { suggestions: suggestions(), warnings: ["合成建议，仅供审核"], model: "synthetic-mock", snapshotVersion: behavior === "stale" ? "synthetic-stale" : snapshotVersion } }).catch(() => {});
  });
}
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await installMocks(context); const page = await context.newPage();
  const login = async () => {
    await page.getByLabel("访问密码").fill(environment.APP_PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();
  };
  const openManager = async () => {
    if (!await page.locator(".taxonomy-manager").isVisible()) await page.locator(".stats-review-actions").getByRole("button", { name: "分类管理", exact: true }).click();
    await expect(page.getByLabel(`领域 ${alpha}`, { exact: true })).toBeVisible();
  };
  const request = () => page.getByRole("button", { name: /^AI 分类建议/ });
  const confirm = async accepted => {
    const dialog = page.getByRole("alertdialog"); await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: accepted ? "放弃修改" : "取消", exact: true }).click(); await expect(dialog).toHaveCount(0);
  };
  await page.goto(`${base}?view=stats&month=2026-08`); await login(); await openManager();
  await expect(request()).toBeDisabled(); await expect(page.locator(".taxonomy-ai-status")).toContainText("AI 分类建议尚未启用");
  await page.locator('.taxonomy-ai-status .feature-availability summary').click(); await expect(page.locator('.feature-availability-details')).toContainText('模型名称');
  configured = true; await page.getByRole("button", { name: "重新检查", exact: true }).click(); await expect(request()).toBeEnabled();

  saved = { domains: ["其他"], mappings: {}, updatedAt: null, version: null };
  await page.reload(); await openManager(); await expect(request()).toBeDisabled();
  await expect(page.locator(".taxonomy-ai-status")).toContainText("添加并保存自定义领域"); assert.equal(requestCount, 0);
  saved = { domains: [domainA, domainB, "其他"], mappings: {}, updatedAt: null, version: "synthetic-v1" };
  await page.reload(); await openManager(); await request().click();
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveValue(domainA);
  await expect(page.getByLabel(`领域 ${alpha}`, { exact: true })).toHaveValue("其他"); assert.equal(saveCount, 0);
  await page.getByLabel(`采纳建议 ${beta}`, { exact: true }).uncheck();
  await page.getByLabel(`建议领域 ${alpha}`, { exact: true }).selectOption(domainB);
  await page.getByRole("button", { name: "应用建议到草稿", exact: true }).click();
  await expect(page.getByLabel(`领域 ${alpha}`, { exact: true })).toHaveValue(domainB);
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue("其他");
  await expect(page.locator(".stats-draft-status")).toBeVisible(); await expect(request()).toBeDisabled(); assert.equal(saveCount, 0);
  await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await expect(page.locator(".stats-draft-status")).toHaveCount(0); assert.equal(saveCount, 1); assert.equal(saved.mappings[alpha], domainB);

  await request().click(); await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click(); await confirm(false);
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click(); await confirm(true);
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log");
  await page.getByRole("button", { name: "统计", exact: true }).filter({ visible: true }).click(); await openManager();
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveCount(0);

  behavior = "delay"; const pending = waitForSuggestionStart(); await Promise.all([request().click(), pending]);
  await page.getByLabel(`领域 ${alpha}`, { exact: true }).selectOption("其他");
  await expect(page.locator(".taxonomy-ai-status")).toContainText("旧建议未应用"); release(); behavior = "success";
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(`领域 ${alpha}`, { exact: true })).toHaveValue("其他");
  await page.getByRole("button", { name: "保存映射", exact: true }).click(); await expect(request()).toBeEnabled();

  behavior = "stale"; await request().click(); await expect(page.locator(".taxonomy-ai-status")).toContainText("本次建议未载入");
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新读取分类", exact: true }).click(); await expect(request()).toBeEnabled();
  behavior = "success"; await request().click(); await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  saved = { ...saved, version: "synthetic-external-version", mappings: { [beta]: domainA } };
  await page.getByRole("button", { name: "应用建议到草稿", exact: true }).click();
  await expect(page.locator(".taxonomy-ai-status")).toContainText("建议未应用，当前草稿保留");
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue("其他");
  await page.getByRole("button", { name: "重新读取分类", exact: true }).click(); await confirm(false);
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新读取分类", exact: true }).click(); await confirm(true);
  await expect(page.getByLabel(`领域 ${beta}`, { exact: true })).toHaveValue(domainA);

  behavior = "failure"; await request().click(); await expect(page.locator(".taxonomy-ai-status")).toContainText("合成分类服务失败");
  behavior = "success"; await request().click(); await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃建议", exact: true }).click();
  await page.getByLabel(`领域 ${alpha}`, { exact: true }).selectOption(domainB);
  expireSave = true; await page.getByRole("button", { name: "保存映射", exact: true }).click();
  await expect(page.getByLabel("访问密码")).toBeVisible(); await login();
  await expect(page.getByLabel(`领域 ${alpha}`, { exact: true })).toHaveValue(domainB);
  await expect(page.locator(".stats-draft-status")).toBeVisible(); await expect(request()).toBeDisabled();
  await page.getByRole("button", { name: "保存映射", exact: true }).click(); await expect(request()).toBeEnabled();

  behavior = "delay"; const navigating = waitForSuggestionStart(); await Promise.all([request().click(), navigating]);
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("log"); release(); behavior = "success";
  await page.getByRole("button", { name: "统计", exact: true }).filter({ visible: true }).click(); await openManager();
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveCount(0);
  behavior = "delay"; const changingMonth = waitForSuggestionStart(); await Promise.all([request().click(), changingMonth]);
  const anotherMonth = page.locator(".stats-sidebar-content .month-list button:not(.active)").first();
  const targetMonth = (await anotherMonth.textContent()).match(/\d{4}-\d{2}/)[0];
  await anotherMonth.click(); await expect.poll(() => new URL(page.url()).searchParams.get("month")).toBe(targetMonth);
  release(); behavior = "success"; await openManager();
  await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toHaveCount(0);
  await request().click(); await expect(page.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  const artifacts = path.join(root, "artifacts"); await fs.mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "taxonomy-ai-desktop.png"), fullPage: true });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() }); await installMocks(mobile);
  mobile.setDefaultTimeout(15000);
  const phone = await mobile.newPage(); await phone.goto(`${base}?view=stats&month=2026-08`);
  await phone.locator(".stats-review-actions").getByRole("button", { name: "分类管理", exact: true }).click();
  await phone.getByRole("button", { name: /^AI 分类建议/ }).click(); await expect(phone.getByLabel(`建议领域 ${alpha}`, { exact: true })).toBeVisible();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await phone.getByLabel(`建议领域 ${alpha}`, { exact: true }).selectOption(domainA);
  await phone.getByLabel(`采纳建议 ${beta}`, { exact: true }).uncheck();
  await phone.getByLabel(`建议领域 ${alpha}`, { exact: true }).scrollIntoViewIfNeeded();
  await phone.screenshot({ path: path.join(artifacts, "taxonomy-ai-mobile.png"), fullPage: true });
  await phone.getByRole("button", { name: "应用建议到草稿", exact: true }).click();
  await expect(phone.getByLabel(`领域 ${alpha}`, { exact: true })).toHaveValue(domainA);
  await expect(phone.locator(".stats-draft-status")).toBeVisible();
  console.log("PASS taxonomy AI: config gating, Other-only, review/edit/deselect/apply/save, guard, dirty/stale/late cancellation, failure/retry, real 401 draft retention, desktop/mobile; all taxonomy writes/model responses mocked");
} finally { release?.(); await browser.close(); }

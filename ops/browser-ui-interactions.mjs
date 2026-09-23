import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith("ui-parity-") || !base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Fresh synthetic ui-parity- instance and loopback URL required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}?date=2026-01-15`);
  await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".markdown-preview")).toContainText("并发控制");

  await page.locator(".outline-favorite").first().click();
  const notice = page.locator(".favorite-success-notice");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "选择分组", exact: true }).click();
  const groupDialog = page.getByRole("dialog", { name: "选择分组", exact: true });
  await expect(groupDialog).toBeVisible();
  await expect(groupDialog.locator(".favorite-group-dialog-header .favorite-title")).toHaveCount(0);
  await groupDialog.getByRole("button", { name: "收藏中心", exact: true }).click();
  await expect(groupDialog).toHaveCount(0);
  await expect(page).toHaveURL(/view=favorites/);
  await expect(page.locator(".favorite-item-center").first()).toBeVisible();
  await page.locator(".favorite-item-center").first().getByRole("button", { name: /选择.*收藏分组/ }).click();
  await expect(groupDialog.getByRole("button", { name: "收藏中心", exact: true })).toBeVisible();
  await groupDialog.getByRole("button", { name: "收藏中心", exact: true }).click();
  await expect(groupDialog).toHaveCount(0);
  await expect(page).toHaveURL(/view=favorites/);

  await page.setViewportSize({ width: 390, height: 900 });
  const mobileNav = page.locator(".mobile-bottom-nav");
  for (const [module, open, subtitle, dialog] of [
    ["随记", "打开随记筛选", "按年份和标签筛选", "随记导航"],
    ["收藏", "打开收藏筛选", "按分组和日志月份筛选", "收藏中心导航"],
    ["统计", "打开统计导航", "切换月份与管理分类", "学习统计导航"],
    ["问答", "打开问答历史", "历史会话", "知识问答导航"]
  ]) {
    await mobileNav.getByRole("button", { name: module, exact: true }).click();
    await page.getByRole("button", { name: open, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialog, exact: true })).toBeVisible();
    await expect(page.locator(".mobile-drawer-header span")).toHaveText(subtitle);
    await expect(page.locator(".sidebar-filter-heading .section-title")).toBeHidden();
    if (module === "随记") await expect(page.getByRole("button", { name: "导出全部随记" })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${module} drawer overflows`);
    await page.getByRole("button", { name: "关闭左侧导航" }).click();
  }
  assert.deepEqual(errors, []);
  console.log("Passed: favorite group center navigation and module-specific mobile drawer content");
} finally { await browser.close(); }

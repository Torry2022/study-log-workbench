import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw Error("Local synthetic instance required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + "?date=2026-01-15");
  await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const month = id => page.locator(".month-list button").filter({ hasText: id });
  const date = page.locator(".reader-log-identity h2");
  await expect(date).toContainText("2026-01-15");
  await month("2026-01").dblclick();
  await expect(date).toContainText("2026-01-15");
  await expect(page.locator(".editor-save-status[role=alert]")).toHaveCount(0);
  // A same-month click is not a navigation away from an unsaved document.
  await page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click(); await editor.press("Control+End"); await page.keyboard.insertText("\n月份重复点击保留草稿");
  await month("2026-01").dblclick();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(editor).toContainText("月份重复点击保留草稿");
  await month("2026-02").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(date).toContainText("2026-01-15");
  await expect(editor).toContainText("月份重复点击保留草稿");
  await month("2026-02").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(date).toContainText("2026-02-05");
  await month("2026-02").dblclick();
  await expect(date).toContainText("2026-02-05");
  await page.goBack(); await expect(date).toContainText("2026-01-15");
  await page.goForward(); await expect(date).toContainText("2026-02-05");
  // Hold one month's response while the user switches away and back.
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  await page.route("**/api/logs?month=2026-01", async route => {
    const response = await route.fetch(); started(); await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await month("2026-01").click(); await requested;
  await month("2026-01").dblclick();
  await month("2026-02").click();
  await expect(date).toContainText("2026-02-05");
  release(); await page.unroute("**/api/logs?month=2026-01");
  await expect(date).toContainText("2026-02-05");
  assert.equal(new URL(page.url()).searchParams.get("date"), "2026-02-05");
  // An actually empty library must never emit a missing-favorite diagnostic.
  await page.route("**/api/logs/months", route => route.fulfill({ json: { months: [] } }));
  await page.goto(base);
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(date).toContainText("未选择日期");
  await expect(page.getByText("原收藏小节未找到，已打开所属日期。", { exact: true })).toHaveCount(0);
  console.log("Passed: repeat month selection, draft preservation/cancel, history, delayed cross-month response, empty-library diagnostics");
} finally { await browser.close(); }

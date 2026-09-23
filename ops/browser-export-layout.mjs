import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname) || new URL(base).port === "3577") throw Error("Explicit local synthetic instance required");
const { APP_PASSWORD } = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1912, height: 949 }, acceptDownloads: true });
  await page.goto(`${base}?date=2026-02-05`);
  await page.getByLabel("访问密码").fill(APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".markdown-preview")).toContainText("并发控制");
  const positions = () => page.evaluate(() => {
    const toolbar = document.querySelector(".reader-toolbar-log");
    const preview = document.querySelector(".markdown-preview");
    return [toolbar.getBoundingClientRect().top, toolbar.getBoundingClientRect().bottom, preview.getBoundingClientRect().top];
  });
  let baseline = await positions();
  const controls = () => page.evaluate(() => Object.fromEntries([
    ".reader-log-identity", ".reader-mode-actions", ".log-action-refresh",
    ".log-action-export > button", ".log-action-backup", ".log-action-delete", ".toolbar-save-button"
  ].map(selector => {
    const element = document.querySelector(`.reader-toolbar-log ${selector}`);
    const bounds = element.getBoundingClientRect();
    return [selector, [bounds.x, bounds.y, bounds.width, bounds.height]];
  })));
  let baselineControls = await controls();
  const stable = async () => {
    const current = await positions();
    current.forEach((value, index) => assert.ok(Math.abs(value - baseline[index]) < 1, `Reader layout shifted at ${index}: ${baseline[index]} -> ${value}`));
    const currentControls = await controls();
    for (const [selector, original] of Object.entries(baselineControls)) {
      currentControls[selector].forEach((value, index) => assert.ok(Math.abs(value - original[index]) < 1,
        `${selector} shifted at ${index}: ${original[index]} -> ${value}`));
    }
    assert.equal(await page.locator(".reader > .editor-navigation-status").count(), 0);
  };
  const choose = async () => {
    const exportButton = page.locator('.reader-toolbar-log .export-menu > button[title="导出"]');
    if (await exportButton.isVisible()) {
      await exportButton.click();
      await page.getByRole("menuitem", { name: "当前日块", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "更多操作" }).click();
      await page.getByRole("menuitem", { name: "导出当前日块", exact: true }).click();
    }
  };

  for (const width of [1912, 1600, 1440, 1200, 1024]) {
    await page.setViewportSize({ width, height: 949 });
    await page.waitForTimeout(220);
    baseline = await positions();
    baselineControls = await controls();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/api/export?**", async route => {
      await gate;
      await route.fulfill({ status: 500, json: { error: "合成取消响应" } }).catch(() => {});
    });
    await choose();
    await expect(page.getByRole("button", { name: "取消导出", exact: true })).toBeVisible();
    await stable();
    await page.getByRole("button", { name: "取消导出", exact: true }).click();
    release();
    await page.unroute("**/api/export?**");
    await expect(page.getByRole("button", { name: "取消导出", exact: true })).toHaveCount(0);
    await stable();
  }

  const downloadEvent = page.waitForEvent("download");
  await choose();
  const download = await downloadEvent;
  assert.equal(await download.failure(), null);
  await expect(page.getByText("下载已开始", { exact: true })).toHaveCount(0);
  await stable();

  await page.route("**/api/export?**", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "x-export-warning-count": "2" } });
  });
  const warningDownload = page.waitForEvent("download");
  await choose();
  await warningDownload;
  await expect(page.locator(".toast.warning")).toContainText("2 个附件缺失");
  await stable();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.unroute("**/api/export?**");

  await page.route("**/api/export?**", route => route.fulfill({ status: 500, json: { error: "合成导出失败" } }));
  await choose();
  await expect(page.locator(".toast.error")).toContainText("合成导出失败");
  await stable();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await stable();

  await page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await editor.press("Control+End");
  await page.keyboard.insertText("\n\nTOOLBAR_STATE_TEST_UNSAVED");
  baseline = await positions();
  baselineControls = await controls();
  let finishSave;
  const saveGate = new Promise(resolve => { finishSave = resolve; });
  await page.route("**/api/logs/day", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    await saveGate;
    await route.fulfill({ status: 500, json: { error: "合成保存失败" } }).catch(() => {});
  });
  await page.getByRole("button", { name: "保存", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("button", { name: "保存中", exact: true }).filter({ visible: true })).toBeVisible();
  await stable();
  finishSave();
  await expect(page.locator(".editor-save-status")).toContainText("合成保存失败");
  await page.unroute("**/api/logs/day");
  console.log("Passed: export states at five desktop widths and save-busy state keep toolbar controls fixed");
} finally { await browser.close(); }

import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3563/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("Explicit synthetic instance root and loopback server required");
}
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}?view=favorites`);
  await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page).toHaveURL(/view=favorites/);
  await expect.poll(() => new URL(page.url()).searchParams.get("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const initialized = new URL(page.url());
  assert.equal(initialized.searchParams.get("view"), "favorites");
  const date = initialized.searchParams.get("date");
  const month = initialized.searchParams.get("month");

  await page.goto(`${base}?view=log&date=${date}`);
  const favoritesButton = () => page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true });
  const sourceButton = () => page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true });
  const editor = page.locator(".cm-content");
  const markDirty = async marker => {
    await sourceButton().click();
    await expect(editor).toBeVisible();
    await editor.click(); await editor.press("Control+End"); await page.keyboard.insertText(`\n${marker}`);
    await expect(page.locator(".editor-save-status")).toContainText("有未保存修改");
  };
  const answer = async accept => {
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: accept ? "放弃修改" : "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  const expectView = async view => {
    await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe(view);
    assert.equal(new URL(page.url()).searchParams.get("date"), date);
    assert.equal(new URL(page.url()).searchParams.get("month"), month);
  };

  await markDirty("synthetic view-cancel draft");
  await favoritesButton().click(); await answer(false);
  await expectView("log"); await expect(editor).toContainText("synthetic view-cancel draft");
  await favoritesButton().click(); await answer(true); await expectView("favorites");

  await page.goBack(); await expectView("log");
  await markDirty("synthetic popstate-cancel draft");
  await page.goForward(); await answer(false); await expectView("log");
  await expect(editor).toContainText("synthetic popstate-cancel draft");
  // Wait for the compensating history.go from cancellation before the next attempt.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.goForward(); await answer(true); await expectView("favorites");
  await page.goBack(); await expectView("log");
  await expect(editor).not.toContainText("synthetic popstate-cancel draft");

  console.log("Passed: favorites deep-link initialization, date/month retention, guarded view transitions, guarded back/forward cancellation and acceptance");
} finally { await browser.close(); }

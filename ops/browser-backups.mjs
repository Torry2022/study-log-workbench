import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { clickLogAction } from "./browser-log-actions.mjs";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local synthetic fixture required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
const date = "2026-05-11", neighborDate = "2026-05-12";
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  await fs.mkdir(path.resolve("artifacts/backups"), { recursive: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const getDay = async date => (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  const save = async (date, content) => {
    const day = await getDay(date);
    const response = await page.request.put(`${base}/api/logs/day`, { data: { date, content, baseVersion: day.version } });
    assert.equal(response.status(), 200); return (await response.json()).day;
  };
  const dialog = page.getByRole("dialog", { name: "日志历史版本", exact: true });
  const rows = dialog.locator(".backup-version-list button");
  const open = async () => {
    await clickLogAction(page, "日志历史版本"); await expect(dialog).toBeVisible();
  };
  const close = async () => { await dialog.getByRole("button", { name: "关闭日志历史版本", exact: true }).click(); await expect(dialog).not.toBeVisible(); };
  const select = async (index = 0) => { await rows.nth(index).click(); await expect(dialog.locator(".backup-diff-viewer")).toBeVisible(); };
  const confirm = async () => { const modal = page.getByRole("alertdialog"); await expect(modal).toBeVisible(); await modal.getByRole("button").last().click(); await expect(modal).not.toBeVisible(); };
  const restore = async () => { await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click(); await confirm(); };
  await page.goto(base); await login();
  const neighbor = await save(neighborDate, "### 1. 相邻日块\n\n恢复五月十一日时须保持本日原文。");
  const long = Array.from({ length: 100 }, (_, i) => `合成比较行 ${i}：当前和历史分别记录滚动位置。`).join("\n\n");
  for (const version of ["历史甲", "历史乙", "历史丙", "当前丁"]) await save(date, `### 1. ${version}\n\n${long}`);
  await page.goto(`${base}?date=${date}`);
  const { backup } = await (await page.request.get(`${base}/api/backups?date=${date}`)).json();
  assert.ok(backup.write.length >= 3);

  console.log("Backups: prepared synthetic versions");
  // Exercise initial and subsequent page failures without manufacturing filesystem archives.
  let initialFailures = true, pageFailures = true;
  await page.route("**/api/backups?**", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor && initialFailures) return route.fulfill({ status: 500, json: { error: "合成首屏读取失败" } });
    if (cursor && pageFailures) return route.fulfill({ status: 500, json: { error: "合成后续分页失败" } });
    return route.fulfill({ json: { backup: cursor ? { write: backup.write.slice(1), nextCursor: null } : { write: backup.write.slice(0, 1), nextCursor: "synthetic-page" } } });
  });
  await open(); await expect(dialog.locator(".backup-version-toggle")).not.toBeVisible(); await expect(dialog).toContainText("合成首屏读取失败"); initialFailures = false; await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog).toContainText("合成后续分页失败"); await expect(rows).toHaveCount(1); pageFailures = false; await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(rows).toHaveCount(backup.write.length); await page.unroute("**/api/backups?**");

  console.log("Backups: paginated list retry passed");
  let previewFailures = 1;
  await page.route("**/api/backups/preview?**", route => previewFailures-- > 0 ? route.fulfill({ status: 500, json: { error: "合成预览失败" } }) : route.continue());
  await rows.first().click(); await expect(dialog).toContainText("合成预览失败"); await dialog.getByRole("button", { name: "重试", exact: true }).click(); await expect(dialog.locator(".backup-diff-viewer")).toBeVisible(); await page.unroute("**/api/backups/preview?**");
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
  await page.route("**/api/backups/preview?**", async route => {
    if (new URL(route.request().url()).searchParams.get("id") !== backup.write[0].id) return route.continue();
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => {});
  });
  await rows.first().click(); await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("Delayed preview request did not arrive")), 15_000))]); await select(1); const historical = await dialog.locator(".backup-diff-cell.historical code").allTextContents(); release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await dialog.locator(".backup-diff-cell.historical code").allTextContents(), historical); await page.unroute("**/api/backups/preview?**"); await page.screenshot({ path: path.resolve("artifacts/backups/desktop.png") }); await close();
  console.log("Backups: preview retry and cancellation passed");

  // A canceled confirmation and both restore error paths must retain the local draft.
  await page.getByRole("button", { name: "源码", exact: true }).filter({ visible: true }).click();
  const editor = page.locator(".cm-content"); await editor.press("Control+End"); await page.keyboard.insertText("\n未保存草稿保护");
  await open(); await select();
  let writes = 0;
  await page.route("**/api/backups/restore", route => { writes++; return route.continue(); });
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("alertdialog")).not.toBeVisible();
  assert.equal(writes, 0); await expect(editor).toContainText("未保存草稿保护");
  await save(date, `### 1. 其他窗口的新版本\n\n${long}`);
  await restore(); await expect(dialog.getByRole("button", { name: "重新预览", exact: true })).toBeVisible();
  assert.equal(writes, 1); await expect(dialog.getByRole("button", { name: "恢复此版本", exact: true })).toHaveCount(0); await expect(editor).toContainText("未保存草稿保护");
  await dialog.getByRole("button", { name: "重新预览", exact: true }).click(); await expect(dialog.locator(".backup-diff-viewer")).toContainText("其他窗口的新版本");
  assert.equal(writes, 1); await page.unroute("**/api/backups/restore");
  let restoreFailures = 1;
  await page.route("**/api/backups/restore", route => restoreFailures-- > 0 ? route.fulfill({ status: 500, json: { error: "合成恢复失败" } }) : route.continue());
  await restore(); await expect(dialog).toContainText("合成恢复失败"); await expect(editor).toContainText("未保存草稿保护");
  await restore(); await expect(dialog).not.toBeVisible(); await page.unroute("**/api/backups/restore");
  await expect(editor).not.toContainText("未保存草稿保护"); assert.equal((await getDay(neighborDate)).content, neighbor.content);

  console.log("Backups: draft-safe restore and conflicts passed");
  // Delete cancellation leaves the authoritative day; confirmed deletion is recoverable.
  const deleteButton = page.getByRole("button", { name: "删除当前日志", exact: true }).filter({ visible: true });
  await deleteButton.click(); await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("alertdialog")).not.toBeVisible(); assert.equal((await getDay(date)).exists, true);
  const deletedResponse = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/api/logs/day"));
  await deleteButton.click(); await confirm(); const deleted = await deletedResponse; assert.equal(deleted.status(), 200, JSON.stringify(await deleted.json())); await expect.poll(async () => (await getDay(date)).exists).toBe(false);
  await open(); await select(); await restore(); await expect(dialog).not.toBeVisible(); assert.equal((await getDay(date)).exists, true); assert.equal((await getDay(neighborDate)).content, neighbor.content);

  console.log("Backups: delete and restore passed");
  // Mobile compares one side at a time and remembers each side's scroll offset.
  await page.setViewportSize({ width: 390, height: 844 }); await open(); await select(); await expect(dialog.locator(".backup-version-panel")).not.toBeVisible();
  const scroll = dialog.locator(".backup-diff-scroll");
  await scroll.evaluate(element => { element.scrollTop = 95; });
  await dialog.getByRole("button", { name: "历史内容", exact: true }).click(); await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
  await scroll.evaluate(element => { element.scrollTop = 175; });
  await dialog.getByRole("button", { name: "当前内容", exact: true }).click(); await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(95);
  await dialog.getByRole("button", { name: "历史内容", exact: true }).click(); await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(175);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await fs.mkdir(path.resolve("artifacts/backups"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/backups/mobile.png") });

  console.log("Backups: mobile side scrolling passed");
  // Expiration during nested confirmation must unwind both modal focus and scroll locks.
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click(); await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired")));
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole("alertdialog")).not.toBeVisible(); await login();
  await expect(dialog).not.toBeVisible(); assert.equal(await page.locator(".workspace").evaluate(element => Boolean(element.closest("[inert]"))), false, "Session recovery left workspace inert"); assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden"); assert.notEqual(await page.evaluate(() => document.documentElement.style.overflow), "hidden");
  await open();
  await page.route("**/api/backups/preview?**", route => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await rows.first().click(); await expect(page.getByLabel("访问密码")).toBeVisible(); await expect(dialog).not.toBeVisible(); await page.unroute("**/api/backups/preview?**"); await login();
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden"); assert.deepEqual(errors, []);
  console.log("Passed: backup list/preview retries and pagination, stale preview cancellation, draft-safe cancel/errors, explicit conflict re-preview, restore/delete/restore with neighbor preservation, mobile side scroll, nested-confirmation and preview expiration cleanup");
} finally { await browser.close(); }

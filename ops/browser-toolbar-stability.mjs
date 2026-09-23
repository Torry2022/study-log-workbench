import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !base || !["127.0.0.1", "localhost"].includes(new URL(base).hostname) || new URL(base).port === "3577") throw Error("Explicit local synthetic instance required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
try {
  for (const width of [1912, 1440, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}?date=2026-01-15`);
    await page.getByLabel("访问密码").fill(env.APP_PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.locator(".markdown-preview")).not.toBeEmpty();
    await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollTo({ top: 5, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(5);
    const border = () => page.locator(".reader-toolbar-log").evaluate(element => element.getBoundingClientRect().bottom);
    const before = await border();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    await page.route("**/api/logs/day?date=2026-01-17", async route => {
      const response = await route.fetch(); started(); await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.locator(".day-item-open").filter({ hasText: "01-17" }).click();
    await requested;
    await expect(page.locator(".preview-loading")).toBeVisible();
    const during = await border();
    assert.equal(await page.evaluate(() => window.scrollY), 0, "Ordinary date navigation should reach the top before loading");
    release();
    await expect(page.locator(".markdown-preview")).toContainText("文件版本");
    const after = await border();
    assert.ok(Math.abs(during - after) < 0.1, `Toolbar border shifted after loading: ${during} -> ${after}`);
    assert.ok(Math.abs(before + 5 - after) < 0.1, "The only displacement is the intentional scroll to top at navigation start");
    await page.close();
  }
  console.log("Passed: toolbar border stays fixed through loading and completion after near-top log navigation");
} finally { await browser.close(); }

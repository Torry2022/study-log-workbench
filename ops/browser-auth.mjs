import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [root, base = "http://127.0.0.1:3562/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw new Error("Use an explicit local synthetic instance");
const environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const output = path.resolve("artifacts/auth");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height, theme] of [["desktop-light", 1440, 900, "light"], ["mobile-dark", 390, 844, "dark"]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole("button", { name: "登录", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      theme: document.documentElement.dataset.theme,
      titleFamily: getComputedStyle(document.querySelector("#login-title")).fontFamily,
      titleWeight: getComputedStyle(document.querySelector("#login-title")).fontWeight,
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status }))
    }));
    assert.ok(metrics.width <= metrics.viewport, JSON.stringify(metrics));
    assert.equal(metrics.theme, theme);
    if (width === 390) {
      assert.match(metrics.titleFamily, /Study Log Serif/);
      assert.ok(metrics.fonts.some(font => font.family.includes("Study Log Serif") && font.status === "loaded"));
    }
    await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
    await page.getByLabel("访问密码").fill("wrong");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "密码错误" }).waitFor();
    await page.getByLabel("访问密码").fill(environment.APP_PASSWORD);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.locator(".workspace").waitFor();
    await page.reload();
    await page.locator(".workspace").waitFor();
    if (width === 390) {
      await page.getByRole("button", { name: "更多设置", exact: true }).click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "退出", exact: true }).click();
    }
    await page.getByRole("button", { name: "登录", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.push({ name, metrics, login: "passed", refresh: "passed", logout: "passed", errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.map(result => result.name), output }));
} finally { await browser.close(); }

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const evidence = path.resolve(process.argv[2] || ".local/desktop-browser");
const packageRoot = path.resolve(process.argv[3]);
const implementation = process.argv[4] === "package" ? path.join(packageRoot, "ops", "desktop") : path.resolve("ops/desktop");
const { startLauncher } = await import(pathToFileURL(path.join(implementation, "launcher.mjs")));
const { DesktopManager } = await import(pathToFileURL(path.join(implementation, "manager.mjs")));
await fs.mkdir(evidence, { recursive: true });
const synthetic = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-desktop-browser-"));
const manager = new DesktopManager({ packageRoot });
const launcher = await startLauncher({ packageRoot, manager, stateRoot: path.join(synthetic, "state"), openBrowser: false,
  assetsRoot: path.resolve("study-log-web/public"), iconFile: path.resolve("study-log-web/app/icon.svg") });
const browser = await chromium.launch({ headless: true });
const passed = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1912, height: 948 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${launcher.origin}/#${launcher.token}`);
  await expect(page.locator("#state")).toHaveText("未运行");
  assert.equal(new URL(page.url()).hash, "");
  const shot = async name => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true, animations: "disabled" }); };
  const setRoot = async root => { await page.locator("#root").fill(root); await expect(page.locator("#current")).not.toHaveText("正在检查目录…"); };
  await expect(page.locator("#start")).toBeDisabled(); await expect(page.locator("#stop, #exit")).toHaveCount(0);
  await expect(page.locator("#create")).toBeHidden();
  await expect(page.locator("#configure")).toBeDisabled(); await expect(page.locator("#backup")).toBeDisabled();
  const geometry = await page.locator(".workspace-grid > section").evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
  assert.equal(geometry[0].y, geometry[1].y);
  assert.ok(geometry[1].x > geometry[0].x + geometry[0].width);
  await shot("wide-light-unselected");
  await page.emulateMedia({ colorScheme: "dark" }); await shot("wide-dark-unselected");
  const nonempty = path.join(synthetic, "unrelated"); await fs.mkdir(nonempty); await fs.writeFile(path.join(nonempty, "keep.txt"), "untouched");
  await setRoot(nonempty); await expect(page.locator("#current")).toContainText("此目录已有文件");
  await expect(page.locator("#create")).toBeHidden(); await expect(page.locator("#select")).toBeHidden(); await expect(page.locator("#start")).toBeDisabled();
  await shot("wide-dark-nonempty");
  const selectedRoot = path.join(synthetic, "instance");
  await page.route("**/api/pick", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ path: selectedRoot }) }));
  await page.getByRole("button", { name: "选择目录", exact: true }).click();
  await expect(page.locator("#current")).toContainText("此目录可用于新建实例");
  await expect(page.locator("#start")).toBeDisabled(); await expect(page.locator("#create")).toBeDisabled();
  await page.locator("#password").fill("short"); await expect(page.locator("#create")).toBeDisabled();
  await page.locator("#password").fill("synthetic-browser-password"); await expect(page.locator("#create")).toBeEnabled();
  await shot("wide-dark-new");
  await page.locator("#create").click(); await expect(page.locator("#current")).toHaveText("资料目录已就绪。", { timeout: 30000 });
  await expect(page.locator("#create-fields")).toBeHidden(); await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#directory-notice")).toBeHidden();
  await page.unroute("**/api/pick");
  await setRoot(nonempty); await expect(page.locator("#start")).toBeDisabled();
  await setRoot(selectedRoot); await expect(page.locator("#start")).toBeEnabled();
  // A new launcher has not selected the instance: valid directory offers open, never create or start.
  const other = await startLauncher({ packageRoot, stateRoot: path.join(synthetic, "other-state"), openBrowser: false, assetsRoot: path.resolve("study-log-web/public") });
  const second = await browser.newPage();
  try {
    await second.goto(`${other.origin}/#${other.token}`); await expect(second.locator("#root")).toBeEnabled();
    await second.locator("#root").fill(selectedRoot); await expect(second.locator("#select")).toBeEnabled();
    await expect(second.locator("#create")).toBeHidden(); await expect(second.locator("#start")).toBeDisabled();
    await second.locator("#select").click(); await expect(second.locator("#current")).toHaveText("资料目录已就绪。");
  } finally { await other.close(); await second.close(); }
  passed.push("Unselected, empty/new, nonempty unrelated, existing-but-unopened and ready directories gate actions; picker and typed paths agree");
  await page.getByText("模型配置（可选）", { exact: true }).click();
  await page.getByLabel("模型接口地址").fill("https://example.invalid/v1/chat/completions");
  await page.getByLabel("模型名称").fill("synthetic-model");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-browser-key");
  await page.locator("#configure").click(); await expect(page.locator("#keyStatus")).toHaveText("已保存 API Key");
  await expect(page.locator("#apiKey")).toHaveValue("");
  await page.reload(); await expect(page.locator("#current")).toHaveText("资料目录已就绪。");
  await expect(page.locator("#keyStatus")).toHaveText("已保存 API Key");
  await page.route("**/api/pick", route => route.fulfill({ contentType: "application/json", body: '{"path":""}' }));
  await page.getByRole("button", { name: "选择目录", exact: true }).click();
  await expect(page.locator("#start")).toBeEnabled(); await expect(page.locator("#root")).toHaveValue(selectedRoot);
  await page.unroute("**/api/pick");
  await page.locator("#start").click(); await expect(page.locator("#state")).toHaveText("正在运行", { timeout: 60000 });
  await expect(page.locator("#start")).toHaveText("停止工作台"); await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#root")).toBeDisabled(); await expect(page.locator("#configure")).toBeDisabled();
  assert.equal((await page.request.get(await page.locator("#open").getAttribute("href"))).status(), 200);
  await shot("wide-dark-running");
  await page.locator("#start").click(); await expect(page.locator("#state")).toHaveText("未运行", { timeout: 60000 });
  await expect(page.locator("#stop, #exit")).toHaveCount(0); await expect(page.locator("#run-notice")).toBeHidden();
  await expect(page.locator("#start")).toBeEnabled(); await shot("wide-dark-ready");
  assert.equal(await fs.stat(path.join(selectedRoot, "data", ".instance-operation.lock")).catch(() => null), null);
  passed.push("Actual packaged Web/MCP start, HTTP 200, running controls, graceful stop and lock release; no duplicate stop notification");
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("details").evaluateAll(nodes => nodes.forEach(node => node.open = true));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(`narrow-${theme}-settings`);
  }
  // Real startup failure must refresh service state, not re-enable every action.
  manager.mcpRoot = path.join(synthetic, "missing-service");
  await page.locator("#start").click();
  await expect(page.locator("#state")).toHaveText("运行异常", { timeout: 60000 });
  await expect(page.locator("#start")).toBeDisabled();
  await expect(page.locator("#run-notice")).toBeVisible();

  passed.push("Actual service startup failure refreshes failed state, blocks restart and does not offer an invalid restart");
  assert.equal(await fs.readFile(path.join(nonempty, "keep.txt"), "utf8"), "untouched");
  assert.deepEqual(errors, []);
  passed.push("Light/dark wide/narrow screenshots, settings/key retention, picker cancellation and unrelated files preserved");
  await fs.writeFile(path.join(evidence, "report.json"), JSON.stringify({ passed, implementation, paidCalls: 0, limitation: "Native picker result/cancellation uses a protocol stub; directory inspection and instance/service operations are real, isolated synthetic data." }, null, 2));
  console.log(JSON.stringify({ passed, evidence }));
} finally {
  await browser.close(); await launcher.close();
  assert.equal(path.dirname(synthetic), path.resolve(os.tmpdir())); assert.match(path.basename(synthetic), /^study-log-desktop-browser-/);
  await fs.rm(synthetic, { recursive: true, force: true });
}

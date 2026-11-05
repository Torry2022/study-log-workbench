import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { initialize } from "./instance.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const web = path.join(repository, "study-log-web");
const { chromium, webkit, expect } = createRequire(path.join(web, "package.json"))("@playwright/test");
const output = process.argv[2];
assert.ok(output && path.isAbsolute(output), "An absolute evidence directory is required");
await fs.mkdir(output, { recursive: true });
const instance = await fs.mkdtemp(path.join(output, "stats-instance-"));
await initialize(instance);
const data = path.join(instance, "data");
for (const month of ["2024-09", "2024-10"]) {
  await fs.writeFile(path.join(data, month + "_学习日志.md"), "## " + month + "-15\n\n### 合成统计\n\n测试月度导航。\n");
}
const socket = net.createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const { port } = socket.address();
await new Promise(resolve => socket.close(resolve));
const base = "http://127.0.0.1:" + port + "/study-log";
const password = crypto.randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(systemroot|windir|temp|tmp|userprofile|localappdata|appdata|path|comspec)$/i.test(key)));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: web, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...env, LOG_ROOT: data, BACKUP_ROOT: path.join(instance, "backups"), APP_PASSWORD: password,
    SESSION_SECRET: crypto.randomUUID(), COOKIE_SECURE: "false", CHAT_API_KEY: "", DASHSCOPE_API_KEY: "" }
});
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk; });
server.stderr.on("data", chunk => { serverLog += chunk; });
const results = [];

function view(page, expected) {
  return expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe(expected);
}
async function month(page, expected) {
  await expect.poll(() => new URL(page.url()).searchParams.get("month")).toBe(expected);
  await expect(page.getByLabel("选择统计月份")).toHaveValue(expected);
  await expect(page.locator(".stats-calendar-grid")).toBeVisible();
}
function nav(page, name) {
  return page.getByRole("button", { name, exact: true }).filter({ visible: true }).last().click();
}

try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(base).then(response => response.ok, () => false)) break;
    assert.ok(attempt < 120 && server.exitCode === null, serverLog);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const [engine, launcher] of [["chromium", chromium], ["webkit", webkit]]) {
    const browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      assert.ok((await context.request.post(base + "/api/auth/login", { data: { password } })).ok());
      const available = (await (await context.request.get(base + "/api/logs/months")).json()).months;
      const defaultMonth = available[0].id;
      const otherMonth = available.find(entry => entry.id !== defaultMonth).id;
      const page = await context.newPage();
      await page.goto(base + "?view=qa");
      await nav(page, "统计");
      await month(page, defaultMonth);
      await page.getByLabel("选择统计月份").selectOption(otherMonth);
      await month(page, otherMonth);
      await page.goBack();
      await month(page, defaultMonth);
      await page.goBack();
      await view(page, "qa");
      await page.goForward();
      await month(page, defaultMonth);
      await page.goForward();
      await month(page, otherMonth);
      results.push({ engine, scenario: "default replaces and manual month adds history", defaultMonth, otherMonth });
      await page.close();

      const pending = await context.newPage();
      let reads = 0, releaseFirst;
      const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
      await pending.route("**/api/taxonomy", async route => {
        if (++reads === 1) await firstResponse;
        await route.continue().catch(() => {});
      });
      try {
        await pending.goto(base + "?view=qa");
        await nav(pending, "统计");
        await expect.poll(() => reads).toBe(1);
        await nav(pending, "随记");
        await view(pending, "notes");
        await nav(pending, "统计");
        await month(pending, defaultMonth);
        assert.equal(reads, 2);
        results.push({ engine, scenario: "cancelled initialization restarts on re-entry", reads });
      } finally {
        releaseFirst();
        await pending.close();
      }

      const retry = await context.newPage();
      let fail = true;
      await retry.route("**/api/taxonomy", async route => {
        if (!fail) return route.continue();
        await route.fulfill({ status: 503, json: { error: "合成分类读取失败" } });
      });
      await retry.goto(base + "?view=stats&month=" + otherMonth);
      await expect(retry.locator(".stats-feedback.error")).toContainText("合成分类读取失败");
      fail = false;
      await nav(retry, "重新读取分类");
      await month(retry, otherMonth);
      results.push({ engine, scenario: "initial error can retry without replacing an explicit month" });
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  await fs.writeFile(path.join(output, "server.log"), serverLog);
}

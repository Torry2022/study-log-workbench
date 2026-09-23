import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { archive, docx, pdf, slide } from "./material-fixtures.mjs";
const require = createRequire(new URL("../study-log-web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [root, base = "http://127.0.0.1:3561/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Local synthetic fixture required");
const env = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const browser = await chromium.launch();
const date = "2026-09-13";
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const login = async () => { await page.getByLabel("访问密码").fill(env.APP_PASSWORD); await page.getByRole("button", { name: "登录", exact: true }).click(); await page.locator(".workspace").waitFor(); };
  const panel = page.locator(".writing-panel");
  const material = page.getByLabel("学习材料", { exact: true }), instruction = page.getByLabel("补充要求", { exact: true }), output = page.getByLabel("生成草稿", { exact: true });
  const fileInput = page.getByLabel("导入学习材料文件", { exact: true });
  const open = async () => {
    await page.locator(".workspace").waitFor();
    if (!await panel.isVisible()) {
      const desktop = page.getByRole("button", { name: "AI生成", exact: true }).filter({ visible: true });
      if (page.viewportSize().width > 1023) await desktop.click();
      else { await page.getByRole("button", { name: "更多设置", exact: true }).click(); await page.getByRole("button", { name: "AI 工具", exact: true }).click(); }
    }
    await expect(panel).toBeVisible();
  };
  const confirm = async (accept = true) => { const modal = page.getByRole("alertdialog"); await expect(modal).toBeVisible(); await (accept ? modal.locator(".confirmation-actions button").last() : modal.getByRole("button", { name: "取消", exact: true })).click(); await expect(modal).toHaveCount(0); };
  const day = async () => (await (await page.request.get(`${base}/api/logs/day?date=${date}`)).json()).day;
  const textFile = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  let configured = false, generationCalls = 0, generatedStatus = 200;
  let generatedContent = "### 合成生成草稿\n\nMOCK_ONLY 生成内容。", waitGeneration = null;
  // All generation requests are intercepted for the entire test, including failure scenarios.
  await page.route("**/api/ai/generate", async route => {
    generationCalls++; const request = route.request().postDataJSON(); assert.equal(request.date, date); assert.ok(request.material || request.instruction);
    const response = generatedStatus === 200 ? { status: 200, json: { result: { content: generatedContent, model: "synthetic-mock", warnings: ["合成生成提示"] } } } : { status: generatedStatus, json: { error: generatedStatus === 401 ? "Unauthorized" : "合成生成失败", code: "AI_UPSTREAM_ERROR" } };
    if (waitGeneration) { const gate = waitGeneration; gate.started(); await gate.promise; }
    await route.fulfill(response).catch(() => {});
  });
  await page.route("**/api/capabilities", async route => {
    const response = await route.fetch(); const json = await response.json();
    if (response.ok()) { json.features.aiWriting = { supported: true, configured }; json.aiConfiguration = { provider: { configured, issues: configured ? [] : [{ message: "合成实例尚未配置生成模型" }] }, templates: { generation: { configured: true } } }; }
    await route.fulfill({ response, json });
  });
  await page.goto(base); await login();
  const navigationDate = "2026-09-16";
  const navigationDay = (await (await page.request.get(`${base}/api/logs/day?date=${navigationDate}`)).json()).day;
  assert.ok(!navigationDay.exists || navigationDay.content.includes("WRITING_NAVIGATION_FIXTURE"), "Writing navigation fixture must not overwrite other data");
  assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date: navigationDate, content: "### 导航样本\n\nWRITING_NAVIGATION_FIXTURE", baseVersion: navigationDay.version } })).status(), 200);
  const initial = await day(); assert.equal((await page.request.put(`${base}/api/logs/day`, { data: { date, content: "### 原有内容\n\nORIGINAL_CONTENT 必须保留。", baseVersion: initial.version } })).status(), 200);
  await page.goto(`${base}?date=${date}`); await open();
  await expect(panel).toContainText("合成实例尚未配置生成模型"); await instruction.fill("突出项目实践"); await material.fill("输入材料"); await expect(page.getByRole("button", { name: "生成日志草稿", exact: true })).toBeDisabled(); assert.equal(generationCalls, 0);
  await fs.mkdir(path.resolve("artifacts/writing"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/writing/unconfigured.png") });
  await page.getByRole("button", { name: "折叠右侧栏", exact: true }).click(); await open(); await expect(material).toHaveValue("输入材料");
  await instruction.fill("a".repeat(4001)); await expect(panel).toContainText("补充要求不能超过 4,000 字符"); await instruction.fill("突出项目实践");
  await fileInput.setInputFiles(Array.from({ length: 6 }, (_, i) => textFile(`${i}.txt`, "too many"))); await expect(panel).toContainText("一次最多导入 5 个文件"); await expect(material).toHaveValue("输入材料");
  await fileInput.setInputFiles([textFile("first.txt", "FIRST_TEXT"), textFile("second.md", "# 材料标题\nSECOND_MARKDOWN"), { name: "third.docx", mimeType: "application/octet-stream", buffer: docx("THIRD_DOCX") }, { name: "fourth.pptx", mimeType: "application/octet-stream", buffer: archive([["ppt/slides/slide1.xml", slide("FOURTH_PPTX")]]) }, { name: "fifth.pdf", mimeType: "application/pdf", buffer: pdf(["FIFTH_PDF"]) }]);
  await expect(material).toHaveValue(/FIRST_TEXT[\s\S]*SECOND_MARKDOWN[\s\S]*THIRD_DOCX[\s\S]*FOURTH_PPTX[\s\S]*FIFTH_PDF/); assert.equal(generationCalls, 0);
  await expect(panel).toContainText("PDF仅提取文本层"); await expect(panel).toContainText("PPTX仅提取幻灯片文本");
  await fileInput.setInputFiles([textFile("unsupported.exe", "invalid"), textFile("after-failure.txt", "AFTER_FAILURE")]); await expect(material).toHaveValue(/AFTER_FAILURE/); await expect(panel).toContainText("不支持的材料格式");
  // Real extraction response held until the user has typed more material.
  let releaseImport, startedImport, completedImport;
  const importGate = new Promise(resolve => releaseImport = resolve), importSeen = new Promise(resolve => startedImport = resolve), importDone = new Promise(resolve => completedImport = resolve);
  await page.route("**/api/materials/extract", async route => { const response = await route.fetch(); startedImport(); await importGate; await route.fulfill({ response }).catch(() => {}); completedImport(); });
  await fileInput.setInputFiles(textFile("late.txt", "LATE_EXTRACT")); await importSeen; await material.fill("上传期间继续输入"); releaseImport(); await importDone; await page.unroute("**/api/materials/extract"); await expect(material).toHaveValue("上传期间继续输入\n\n[文件：late.txt]\nLATE_EXTRACT");
  let batchRequests = 0;
  await page.route("**/api/materials/extract", route => {
    batchRequests++;
    return route.fulfill(batchRequests === 1 ? { status: 200, json: { document: { fileName: "retained.txt", text: "BEFORE_AUTH_EXPIRY", sections: [], warnings: [] } } } : { status: 401, json: { error: "Unauthorized" } });
  });
  await fileInput.setInputFiles([textFile("retained.txt", "first"), textFile("expired.txt", "second"), textFile("never-requested.txt", "third")]); await expect(page.getByLabel("访问密码")).toBeVisible(); assert.equal(batchRequests, 2); await page.unroute("**/api/materials/extract"); await login(); await open(); await expect(material).toHaveValue(/BEFORE_AUTH_EXPIRY/);
  await expect(page.getByRole("button", { name: "重新检查配置", exact: true })).toBeEnabled(); configured = true; await page.getByRole("button", { name: "重新检查配置", exact: true }).click(); await expect(page.getByRole("button", { name: "生成日志草稿", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await expect(output).toHaveValue(generatedContent); await expect(panel).toContainText("合成生成提示");
  await output.fill(generatedContent + "\n\n人工修订保留。"); const edited = await output.inputValue();
  const callsBeforeCancel = generationCalls; await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await confirm(false); assert.equal(generationCalls, callsBeforeCancel); await expect(output).toHaveValue(edited);
  generatedStatus = 502; await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await confirm(); await expect(panel).toContainText("合成生成失败"); await expect(output).toHaveValue(edited); generatedStatus = 200;
  const versionBeforeApply = (await day()).version; await page.getByRole("button", { name: "追加到编辑器", exact: true }).click(); await expect(panel).toContainText("尚未保存"); assert.equal((await day()).version, versionBeforeApply);
  await expect(page.locator(".cm-content").filter({ visible: true })).toContainText("ORIGINAL_CONTENT"); await expect(page.locator(".cm-content").filter({ visible: true })).toContainText("人工修订保留");
  const source = page.locator(".cm-content").filter({ visible: true }); await source.click(); await source.press("Control+End"); await page.keyboard.insertText("\n\n追加后在源码继续修订。");
  assert.equal((await day()).version, versionBeforeApply, "Editing the appended source must not save implicitly");
  await page.getByRole("button", { name: "保存", exact: true }).filter({ visible: true }).first().click(); await expect.poll(async () => (await day()).content).toContain("人工修订保留"); await expect.poll(async () => (await day()).content).toContain("追加后在源码继续修订。");
  console.log("Writing: missing configuration, five ordered formats, partial failure, concurrent input, mock generation/retry and append without save passed");

  await page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true }).first().click(); await confirm(false); await expect(material).toHaveValue(/上传期间继续输入/); await expect(output).toHaveValue(edited);
  await page.locator(".day-list .day-item-open").filter({ hasText: "09-16" }).click(); await confirm(false); await expect(page).toHaveURL(/date=2026-09-13/); await expect(output).toHaveValue(edited);
  await page.getByRole("button", { name: "退出", exact: true }).filter({ visible: true }).click(); await confirm(false); await expect(instruction).toHaveValue("突出项目实践");
  let unload = false; page.once("dialog", async dialog => { unload = dialog.type() === "beforeunload"; await dialog.dismiss(); }); await page.reload({ timeout: 3000 }).catch(() => {}); assert.equal(unload, true);
  // Re-login keeps material, requirements and prior output; old response cannot replace them.
  let release, started; const gate = new Promise(resolve => release = resolve), seen = new Promise(resolve => started = resolve);
  waitGeneration = { promise: gate, started }; generatedContent = "### 不应回灌\n\n旧认证响应。";
  await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await confirm(); await seen;
  await page.evaluate(() => window.dispatchEvent(new Event("study-log:auth-expired"))); await expect(page.getByLabel("访问密码")).toBeVisible(); release(); waitGeneration = null; await login(); await open(); await expect(output).toHaveValue(edited); await expect(instruction).toHaveValue("突出项目实践");
  // Confirmed date departure cancels generation; old content cannot land in another date.
  let releaseOld, startedOld; const oldGate = new Promise(resolve => releaseOld = resolve), oldSeen = new Promise(resolve => startedOld = resolve);
  waitGeneration = { promise: oldGate, started: startedOld }; await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await confirm(); await oldSeen;
  await page.locator(".day-list .day-item-open").filter({ hasText: "09-16" }).click(); await confirm(); await expect(page).toHaveURL(/date=2026-09-16/); releaseOld(); waitGeneration = null; await open(); await expect(output).toHaveValue("");
  await page.locator(".day-list .day-item-open").filter({ hasText: date.slice(5) }).click(); await expect(page).toHaveURL(/date=2026-09-13/); await material.fill("明确放弃的材料");
  await page.getByRole("button", { name: "收藏", exact: true }).filter({ visible: true }).first().click(); await confirm();
  await page.getByRole("button", { name: "日志", exact: true }).filter({ visible: true }).first().click(); await open(); await expect(material).toHaveValue(""); await expect(output).toHaveValue("");
  await instruction.fill("手机合成要求"); await material.fill("手机合成材料"); generatedContent = "### 手机模拟草稿\n\n手机生成预览。"; await page.getByRole("button", { name: "生成日志草稿", exact: true }).click(); await expect(output).toHaveValue(generatedContent);
  // Exercise toolbar layout against actual reader width, including keyboard-resized inspector extremes.
  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => window.scrollTo(0, 0));
    const resizer = page.getByRole("separator", { name: "调整右侧栏宽度", exact: true });
    if (width <= 1180) {
      await expect(resizer).toBeHidden();
      assert.ok(await page.locator(".writing-inspector").evaluate(element => element.getBoundingClientRect().top >= document.querySelector(".reader").getBoundingClientRect().bottom - 1), "Narrow desktop inspector follows the reader");
    }
    for (const direction of width > 1180 ? ["Shift+ArrowLeft", "Shift+ArrowRight"] : ["stacked"]) {
      if (direction !== "stacked") { await resizer.focus(); for (let count = 0; count < 20; count++) await resizer.press(direction); }
      const escaped = await page.locator(".reader-toolbar-log").evaluate(toolbar => {
        const bounds = toolbar.closest(".reader").getBoundingClientRect();
        return [...toolbar.querySelectorAll("button,select")].flatMap(control => {
          const rect = control.getBoundingClientRect(); if (!rect.width || !rect.height) return [];
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || (!control.disabled && hit !== control && !control.contains(hit))
            ? [{ label: control.getAttribute("aria-label") || control.textContent, left: rect.left, right: rect.right, reader: [bounds.left, bounds.right] }] : [];
        });
      });
      assert.deepEqual(escaped, [], `Toolbar overflow or blocked hit target at ${width}px (${direction})`);
    }
    if (width > 1180) for (let count = 0; count < 4; count++) await resizer.press("ArrowLeft");
  }
  await page.screenshot({ path: path.resolve("artifacts/writing/desktop-1100.png") }); await page.setViewportSize({ width: 1440, height: 1000 });
  await fs.mkdir(path.resolve("artifacts/writing"), { recursive: true }); await page.screenshot({ path: path.resolve("artifacts/writing/desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await open(); await page.screenshot({ path: path.resolve("artifacts/writing/mobile.png") }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(output).toHaveValue(generatedContent);
  await page.getByRole("button", { name: "追加到编辑器", exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.resolve("artifacts/writing/mobile-preview.png") });
  const mobileVersion = (await day()).version; await page.getByRole("button", { name: "追加到编辑器", exact: true }).click(); assert.equal((await day()).version, mobileVersion);
  await page.getByRole("button", { name: "关闭 AI 工具", exact: true }).click(); await expect(page.locator(".cm-content").filter({ visible: true })).toContainText("手机生成预览"); await page.getByRole("button", { name: "保存", exact: true }).filter({ visible: true }).first().click(); await expect.poll(async () => (await day()).content).toContain("手机生成预览");
  assert.deepEqual(errors, []); console.log("Passed: writing draft departure, refresh, authentication generation, late response and mobile layout");
} finally { await browser.close(); }

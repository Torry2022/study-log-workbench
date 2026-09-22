import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { initialize } from "./instance.mjs";
import { startBudgetProxy } from "./model-budget-proxy.mjs";

// Explicit opt-in only. Routine tests never import or execute this entrypoint.
if (!process.argv.includes("--real-model")) throw new Error("Use --real-model only with an authorized remaining budget");
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "public-workbench-model-"));
const reportFile = process.env.REAL_MODEL_REPORT, ledgerFile = process.env.REAL_MODEL_LEDGER;
if (!reportFile || !path.isAbsolute(reportFile)) throw new Error("Explicit absolute report path required");
const reportHandle = await fs.open(reportFile, "wx", 0o600);
const checks = [], outputs = {};
let web, mcp, proxy;
const port = Number(process.env.REAL_MODEL_PORT || 3575), mcpPort = port + 1;
const base = `http://127.0.0.1:${port}/study-log`;
const children = [];
const source = "## 2026-01-14\n\n### 数据结构（队列）\n\n队列遵循先进先出（FIFO），新元素从队尾进入，已有元素从队首移出。合成实验依次放入任务甲、任务乙和任务丙，移出顺序也是甲、乙、丙。日志没有记录队列的性能基准或锁实现。\n";
async function waitFor(url, headers) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (children.some(child => child.exitCode !== null)) throw new Error("Isolated test service exited before readiness");
    try { if ((await fetch(url, { headers, signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Isolated test service readiness timed out");
}
function start(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  children.push(child); return child;
}
try {
  await initialize(root); await fs.writeFile(path.join(root, "data", "2026-01_学习日志.md"), source, { flag: "wx" });
  const fixture = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  proxy = await startBudgetProxy({ apiKey: process.env.REAL_CHAT_API_KEY, apiUrl: process.env.REAL_CHAT_API_URL, model: process.env.REAL_CHAT_MODEL,
    budgetCny: Number(process.env.REAL_MODEL_REMAINING_CNY), ledgerFile });
  const env = { ...process.env, ...fixture, NODE_ENV: "production", LOG_ROOT: path.join(root, "data"), BACKUP_ROOT: path.join(root, "backups"), INDEX_ROOT: path.join(root, "index"),
    CHAT_API_KEY: proxy.token, CHAT_API_URL: proxy.url, CHAT_MODEL: process.env.REAL_CHAT_MODEL, CHAT_LIGHT_MODEL: process.env.REAL_CHAT_MODEL,
    STUDY_LOG_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`, STUDY_LOG_MCP_TOKEN: crypto.randomBytes(24).toString("base64url"),
    MCP_HTTP_HOST: "127.0.0.1", MCP_HTTP_PORT: String(mcpPort), EMBEDDING_API_KEY: "", EMBEDDING_API_URL: "", EMBEDDING_MODEL: "", RERANK_ENABLED: "false" };
  delete env.REAL_CHAT_API_KEY; env.MCP_HTTP_TOKEN = env.STUDY_LOG_MCP_TOKEN;
  mcp = start(["src/http-server.mjs"], path.join(repository, "study-log-mcp"), env);
  // This isolated process checks model protocols, not the deployment supervisor.
  web = start(["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], path.join(repository, "study-log-web"), env);
  await waitFor(base); await waitFor(`http://127.0.0.1:${mcpPort}/health`, { Authorization: `Bearer ${env.MCP_HTTP_TOKEN}` });
  const login = await fetch(`${base}/api/auth/app-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: fixture.APP_PASSWORD }) });
  assert.equal(login.status, 200); const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function api(route, body, method = "POST") {
    const response = await fetch(`${base}/api${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
    const value = await response.json(); assert.equal(response.status, 200, `${route}: ${value.error || response.status}`); return value;
  }
  const generated = (await api("/ai/generate", { date: "2026-01-15", material: "队列遵循先进先出FIFO。入队发生在队尾，出队发生在队首。合成实验依次放入甲、乙、丙，输出也是甲、乙、丙。", instruction: "仅整理所给材料，不添加性能数字。" })).result;
  assert.ok(generated.content.includes("### ")); assert.match(generated.content, /先进先出|FIFO/); outputs.generation = generated; checks.push("generation returns grounded reviewable day fragment");
  const highlightInput = "### 队列\n\n队列遵循先进先出原则，入队发生在队尾，出队发生在队首。\n\n`queue.push(item)` 是示例代码。";
  const highlighted = (await api("/ai/bold-highlights", { date: "2026-01-14", content: highlightInput })).result;
  assert.equal(highlighted.content.replaceAll("**", ""), highlightInput); outputs.highlighting = highlighted; checks.push("highlight preserves every original character");
  const material = "# 验证方法\n\n用固定的三条任务验证队列的先进先出顺序，比仅阅读接口文档更容易发现出队顺序错误。此处是合成材料，不包含个人经历。";
  const form = new FormData(); form.append("file", new File([material], "synthetic-method.md", { type: "text/markdown" }));
  const extractedResponse = await fetch(`${base}/api/materials/extract`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  assert.equal(extractedResponse.status, 200); const { document } = await extractedResponse.json();
  const candidates = (await api("/notes/candidates", { documents: [document] })).result;
  assert.ok(candidates.candidates.length > 0); outputs.extraction = candidates; checks.push("note extraction yields evidence-backed review candidates");
  for (const mode of ["logs_only", "logs_and_general"]) {
    const response = await fetch(`${base}/api/rag/query`, { method: "POST", headers, body: JSON.stringify({ question: mode === "logs_only" ? "请总结2026年1月14日关于队列的日志记录。" : "请总结2026年1月14日关于队列的日志，并补充常见应用场景。", mode }), signal: AbortSignal.timeout(150_000) });
    assert.equal(response.status, 200); const text = await response.text(); assert.match(text, /event: done/); assert.doesNotMatch(text, /event: error/);
    const done = JSON.parse(text.split("\n\n").find(frame => frame.startsWith("event: done"))?.split("\ndata: ")[1]);
    assert.match(done.answer, /先进先出|FIFO/); assert.ok(done.citations.some(item => item.date === "2026-01-14"));
    if (mode === "logs_and_general") assert.match(done.answer, /通用知识补充/);
    outputs[mode] = done; checks.push(`${mode} reaches done with original-log citations`);
  }
  assert.equal(await fs.readFile(path.join(root, "data", "2026-01_学习日志.md"), "utf8"), source);
  assert.equal((await api("/notes", undefined, "GET")).notes.length, 0);
  checks.push("generation, highlighting, extraction and answers do not auto-write sources or notes");
} catch (error) { outputs.failure = error.message; process.exitCode = 1; }
finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.all(children.map(child => child.exitCode === null ? new Promise(resolve => child.once("exit", resolve)) : undefined));
  const budget = proxy?.report(); await proxy?.close();
  const report = { testedAt: new Date().toISOString(), checks, outputs, budget, syntheticInstance: root, note: "Small synthetic quality sample only; reservations are not actual billing. No embedding or reranking calls." };
  await reportHandle.writeFile(JSON.stringify(report, null, 2)); await reportHandle.sync(); await reportHandle.close();
  console.log(JSON.stringify({ passed: !outputs.failure, checks, budget, failure: outputs.failure, reportFile }));
}

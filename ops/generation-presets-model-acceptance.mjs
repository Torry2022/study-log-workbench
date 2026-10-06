import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fork } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { initialize, acquireInstanceLock } from "./instance.mjs";
import { availablePort } from "./desktop/manager.mjs";
import { runtimeEnvironment } from "./desktop/security.mjs";
import { startBudgetProxy } from "./model-budget-proxy.mjs";

// Maintainer acceptance only. The reviewed manifest contains file paths/budgets,
// never a credential. Each preset is called once; no retry or parallel requests.
const [evidence, manifestPath] = process.argv.slice(2);
if (!evidence || !manifestPath || !path.isAbsolute(evidence) || !path.isAbsolute(manifestPath)) {
  throw new Error("Usage: node ops/generation-presets-model-acceptance.mjs <NEW absolute evidence directory> <reviewed budget manifest.json>");
}
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
assert.ok(Array.isArray(manifest.ledgers) && Array.isArray(manifest.reports));
let prior = 0;
for (const file of manifest.ledgers) {
  assert.ok(path.isAbsolute(file));
  const rows = (await fs.readFile(file, "utf8")).trim().split(/\r?\n/);
  const value = JSON.parse(rows.at(-1)).cumulativeReservedCny;
  assert.ok(Number.isFinite(value) && value >= 0); prior += value;
}
for (const file of manifest.reports) {
  assert.ok(path.isAbsolute(file));
  const value = JSON.parse(await fs.readFile(file, "utf8")).budget.reservedCny;
  assert.ok(Number.isFinite(value) && value >= 0); prior += value;
}
assert.ok(Number.isFinite(manifest.expectedPriorCny) && Math.abs(prior - manifest.expectedPriorCny) < 0.000001, "Reservation history changed; no paid requests allowed");
assert.ok(Number.isFinite(manifest.totalBudgetCny) && manifest.totalBudgetCny > prior);
assert.ok(Number.isFinite(manifest.runBudgetCny) && manifest.runBudgetCny > 0 && manifest.runBudgetCny <= 0.7 && manifest.runBudgetCny <= manifest.totalBudgetCny - prior);
if (!process.env.DEEPSEEK_API_KEY) throw new Error("Approved test credential missing");
await fs.mkdir(evidence);
const root = path.join(evidence, "synthetic-instance"), ledgerFile = path.join(evidence, "reservations.jsonl"), reportFile = path.join(evidence, "report.json");
const report = { testedAt: new Date().toISOString(), priorReservedCny: prior, rounds: [], sourcePreserved: false, backupsEmpty: false, notesEmpty: false,
  stoppedNormally: false, instanceLockReleased: false, budget: null, error: null,
  limitation: "Three synthetic samples, one real generation call per built-in preset. Not a real-user study or long-term model-quality guarantee." };
const reportHandle = await fs.open(reportFile, "wx", 0o600);
const cases = [
  { id: "builtin:daily", material: "这是一份合成技术学习者的当日记录。今天阅读了 TypeScript 的 unknown 与 any 区别：unknown 在使用前需类型收窄，any 跳过相应检查。实际写了一个 typeof value === 'string' 的小练习，没有跑完整工程。还看了 Promise.all 与 Promise.allSettled 的文档，知道前者遇拒绝会提前拒绝，但不意味着其他任务自动取消。明天计划做 AbortController 的请求取消练习，今天没有做。卡点：不清楚多个并发请求如何各自保留失败原因。没有统计学习时长，也没有测性能。", expected: ["保留实际阅读和小练习", "取消练习仍是明日计划", "保留并发失败疑问", "不捏造时长、性能或已经掌握"] },
  { id: "builtin:concepts", material: "以下全部是教材材料摘要和书上的例题，不包含使用者本人学习完成、解题或实验记录。主题：在升序数组中寻找第一个大于等于 target 的位置，区间使用 [left, right)。初始 left=0，right=数组长度；循环条件 left<right；mid=left+Math.floor((right-left)/2)。若 a[mid]<target，则 left=mid+1，否则 right=mid。退出时返回 left，可能等于数组长度。教材例子：数组[1,3,3,7]，target=3，答案下标1；target=8，答案4。复杂度 O(log n)，前提是数组有序并可随机访问。不要将它表述成链表上相同代价的随机访问。不提供任何个人做题数量、成绩或掌握程度。", expected: ["保持左闭右开与两分支更新", "两个例题答案1和4正确", "复杂度适用条件保留", "不虚构我完成、我验证、我掌握等亲历"] },
  { id: "builtin:practice", material: "合成项目实训记录：今天排查本地演示程序 Pine 的请求取消问题。现象：切换日期后，上一个日期的慢响应覆盖了当前编辑草稿。先前尝试只更新 loading=false，没能阻止旧响应写入。随后在新请求时递增 requestId，并在响应后比较捕获的 requestId 与当前值；不一致就丢弃响应。同时用 AbortController 取消旧 fetch。只做了本地3组人为延迟实验：先慢后快、先快后慢、连续切换3次，观察到旧响应未覆盖新草稿。尚未测试断网、超时、保存冲突，也未发布到生产。没有测延迟或CPU占用。下一步计划检查取消发生在响应体读取阶段的行为。必须区分这次局部验证与所有并发问题都解决。", expected: ["保留错误尝试与有效修正机制", "仅3组本地人为延迟验证", "断网超时保存冲突仍未测", "不声称生产通过或全部并发问题解决"] }
];
let proxy, child, ended, release;
try {
  await initialize(root);
  const fixture = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  const sourceFile = path.join(root, "data", "2026-10_学习日志.md");
  const source = "## 2026-10-06\n\n### 合成既有记录\n\n这段已保存内容不可被生成操作改写。\n";
  await fs.writeFile(sourceFile, source, { flag: "wx", mode: 0o600 });
  report.sourceSha256 = crypto.createHash("sha256").update(source).digest("hex");
  proxy = await startBudgetProxy({ apiKey: process.env.DEEPSEEK_API_KEY, apiUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", budgetCny: manifest.runBudgetCny, ledgerFile });
  const port = await availablePort();
  release = await acquireInstanceLock(path.join(root, "data"), "generation-presets-model-acceptance");
  child = fork(path.join(repository, "ops", "desktop", "worker.mjs"), ["web", path.join(repository, "study-log-web")], {
    execArgv: [], windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: runtimeEnvironment({ ...fixture, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", LOG_ROOT: path.join(root, "data"), BACKUP_ROOT: path.join(root, "backups"),
      PORT: String(port), HOSTNAME: "127.0.0.1", CHAT_API_URL: proxy.url, CHAT_API_KEY: proxy.token, CHAT_MODEL: "deepseek-flash" })
  });
  ended = new Promise(resolve => { child.once("error", () => {}); child.once("close", (code, signal) => resolve({ code, signal })); });
  await new Promise((resolve, reject) => {
    child.on("message", message => { if (message?.type === "ready") resolve(); });
    ended.then(() => reject(new Error("Isolated production Web failed to start")));
  });
  const base = `http://127.0.0.1:${port}/study-log`;
  const login = await fetch(`${base}/api/auth/app-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: fixture.APP_PASSWORD }) });
  assert.equal(login.status, 200); const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const available = await fetch(`${base}/api/ai/generation-presets`, { headers });
  assert.equal(available.status, 200);
  const snapshot = await available.json();
  for (const sample of cases) assert.ok(snapshot.presets.some(preset => preset.id === sample.id && preset.readOnly));
  for (const sample of cases) {
    const round = { ...sample, status: null, result: null, error: null };
    report.rounds.push(round);
    try {
      const response = await fetch(`${base}/api/ai/generate`, { method: "POST", headers,
        body: JSON.stringify({ date: "2026-10-06", presetId: sample.id, material: sample.material, instruction: "请依据提供材料，控制在约600字内；资料与个人经历严格区分。" }),
        signal: AbortSignal.timeout(130000) });
      round.status = response.status;
      const payload = await response.json();
      if (!response.ok || !payload.result) { round.error = payload.code || `HTTP_${response.status}`; continue; }
      round.result = payload.result;
    } catch (error) { round.error = error.name || "REQUEST_FAILED"; }
    // Each sample is issued exactly once even when it fails; no automatic retry.
  }
  report.sourcePreserved = (await fs.readFile(sourceFile, "utf8")) === source;
  report.backupsEmpty = (await fs.readdir(path.join(root, "backups"))).length === 0;
  const notes = await fetch(`${base}/api/notes`, { headers });
  report.notesEmpty = notes.ok && (await notes.json()).notes.length === 0;
  assert.ok(report.sourcePreserved && report.backupsEmpty && report.notesEmpty, "Generation unexpectedly persisted data");
} catch (error) { report.error = error.message; }
finally {
  if (child?.connected) child.send({ type: "stop" }, () => {});
  if (ended) {
    const outcome = await ended;
    report.stoppedNormally = outcome.code === 0 && !outcome.signal;
    if (report.stoppedNormally) { await release(); report.instanceLockReleased = true; }
  } else if (release) { await release(); report.instanceLockReleased = true; }
  report.budget = proxy?.report() || null;
  await proxy?.close();
  report.cumulativeReservedCny = prior + (report.budget?.reservedCny || 0);
  await reportHandle.writeFile(JSON.stringify(report, null, 2)); await reportHandle.sync(); await reportHandle.close();
  console.log(JSON.stringify({ cases: report.rounds.map(item => ({ id: item.id, status: item.status, error: item.error })),
    sourcePreserved: report.sourcePreserved, notesEmpty: report.notesEmpty, backupsEmpty: report.backupsEmpty,
    stoppedNormally: report.stoppedNormally, instanceLockReleased: report.instanceLockReleased,
    reservedCny: report.budget?.reservedCny || 0, cumulativeReservedCny: report.cumulativeReservedCny, error: report.error, reportFile }));
  if (report.error || report.rounds.some(item => item.error) || !report.stoppedNormally) process.exitCode = 1;
}

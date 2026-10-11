// Explicit authorized corpus only; copies Markdown into a NEW isolated run directory.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { startBudgetProxy } from "../../ops/model-budget-proxy.mjs";
import { startHttpServer } from "../../study-log-mcp/src/http-server.mjs";
import { createRagQueryStream } from "../lib/rag-query.ts";

const [manifestPath, root, budgetText] = process.argv.slice(2);
const budget = Number(budgetText);
if (!path.isAbsolute(manifestPath || "") || !path.isAbsolute(root || "") || !(budget > 0 && budget <= 2) || !process.env.DEEPSEEK_API_KEY) throw Error("Explicit manifest, NEW absolute output, budget <= 2 CNY and credential required");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.cases) || !manifest.cases.length) throw Error("Corpus and predetermined questions required");
const routes = manifest.routes || ["baseline", "agent"];
if (!Array.isArray(routes) || !routes.length || new Set(routes).size !== routes.length || routes.some(route => !["baseline", "agent", "jev"].includes(route))) throw Error("Invalid comparison routes");
if (routes.includes("jev") && (!process.env.TYPESAFE_API_KEY || manifest.cases.length > 4)) throw Error("Direct TypeSafe credential and at most four cases required");
await fs.mkdir(root);
const data = path.join(root, "data"); await fs.mkdir(data);
const hashes = [];
for (const file of manifest.files) {
  if (!path.isAbsolute(file) || !/^\d{4}(?:-\d{2})?_学习日志\.md$/.test(path.basename(file))) throw Error("Explicit source Markdown required");
  const bytes = await fs.readFile(file);
  await fs.writeFile(path.join(data, path.basename(file)), bytes, { flag: "wx" });
  hashes.push({ file, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify({ ...manifest, hashes }, null, 2));
const results = [];
const jevRequests = [];
const originalFetch = globalThis.fetch;
// Test-only guard: no retries, at most four bounded official TypeSafe requests.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.typesafe.ai") return originalFetch(input, init);
  if (!routes.includes("jev") || jevRequests.length >= 4 || typeof init?.body !== "string" || Buffer.byteLength(init.body) > 64000) throw Error("Jev acceptance request limit");
  const record = { bytes: Buffer.byteLength(init.body), status: null, elapsedMs: null };
  jevRequests.push(record);
  await fs.writeFile(path.join(root, "jev-requests.json"), JSON.stringify(jevRequests, null, 2));
  const start = performance.now();
  try {
    const response = await originalFetch(input, { ...init, redirect: "error" });
    record.status = response.status;
    return response;
  } finally {
    record.elapsedMs = Math.round(performance.now() - start);
    await fs.writeFile(path.join(root, "jev-requests.json"), JSON.stringify(jevRequests, null, 2));
  }
};
const jevReport = () => ({ requested: routes.includes("jev"), requests: jevRequests });
const mcp = await startHttpServer({ logRoot: data, indexRoot: path.join(root, "index"), port: 0, token: "isolated-corpus", retrieval: { embedding: { apiKey: "" }, reranker: { apiKey: "" }, rerankEnabled: false } });
let proxy;
try {
  proxy = await startBudgetProxy({ apiKey: process.env.DEEPSEEK_API_KEY, apiUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", budgetCny: budget, ledgerFile: path.join(root, "ledger.jsonl"), reasoningEffort: manifest.reasoningEffort });
  const chat = { baseUrl: proxy.url, apiKey: proxy.token, model: "deepseek-flash" };
  process.env.RAG_AGENT_TOOL_CALLING_VERIFIED = "true";
  process.env.RAG_JEV_PROVIDER = "typesafe";
  for (const entry of manifest.cases) for (const route of routes) {
    process.env.RAG_AGENT_ENABLED = String(route !== "baseline");
    process.env.RAG_JEV_ENABLED = String(route === "jev");
    const before = proxy.report().records.length, started = performance.now();
    const raw = await new Response(createRagQueryStream({ question: entry.question, mode: "logs_only", history: [] }, { chat, lightChat: chat, mcp: { url: `http://127.0.0.1:${mcp.address.port}/mcp`, token: "isolated-corpus" } }, new AbortController().signal)).text();
    await proxy.settled();
    const events = raw.trim().split("\n\n").filter(Boolean).map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n").slice(1).join("\n").slice(6)) }));
    const terminal = events.at(-1);
    const result = { ...entry, route, elapsedMs: Math.round(performance.now() - started), calls: proxy.report().records.length - before, event: terminal.event, ...terminal.data };
    results.push(result);
    await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ results, budget: proxy.report(), reasoningEffort: manifest.reasoningEffort || "provider_default", jev: jevReport() }, null, 2));
    console.log(JSON.stringify({ id: entry.id, route, event: result.event, calls: result.calls, elapsedMs: result.elapsedMs }));
    if (result.event === "error") throw Error("Evaluation stopped on error; inspect private report before another paid request");
    if (route === "jev" && !result.diagnostics?.agent?.judgment) throw Error("Jev was not evaluated; stop rather than count fallback as success");
  }
} finally {
  await proxy?.close(); await mcp.close();
  globalThis.fetch = originalFetch;
  for (const item of hashes) {
    const current = crypto.createHash("sha256").update(await fs.readFile(item.file)).digest("hex");
    if (current !== item.sha256) throw Error("Source corpus changed during evaluation");
  }
  await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ results, budget: proxy?.report(), reasoningEffort: manifest.reasoningEffort || "provider_default", jev: jevReport(), sourceHashesUnchanged: true }, null, 2));
}

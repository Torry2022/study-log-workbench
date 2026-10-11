// Explicit opt-in; fixed synthetic Chinese material only. Never reads user logs.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { startBudgetProxy } from "../../ops/model-budget-proxy.mjs";
import { startHttpServer } from "../../study-log-mcp/src/http-server.mjs";
import { createRagQueryStream } from "../lib/rag-query.ts";

const [root, remaining] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !Number.isFinite(Number(remaining)) || Number(remaining) < 1 || !process.env.DEEPSEEK_API_KEY) throw Error("NEW absolute synthetic output, reconciled remaining budget >= 1 CNY and DEEPSEEK_API_KEY required");
await fs.mkdir(root); // Never reuse an existing directory.
const data = path.join(root, "data"); await fs.mkdir(data);
await fs.writeFile(path.join(data, "2026-09_学习日志.md"), `## 2026-09-02

### Agent 的工具调用
Agent 可以根据结果继续查找材料。固定流程更容易控制步骤，步骤明确时不必使用 Agent。

## 2026-09-14

### 重试排错
读取接口偶发超时后尝试重试。只读请求可以有限重试；支付和重复写入不能直接照搬。

## 2026-09-23

### 阅读笔记：先回忆，再回看
读完一节先合上书回忆，再对照查漏。陌生概念仍要查证，不能把回忆流畅当成理解正确。
`);
await fs.writeFile(path.join(data, "2026-10_学习日志.md"), `## 2026-10-03

### 超时与重试
沿用上月只读请求的有限重试，改为最多两次。鉴权失败应先修改凭据，不应重试。这个结论只用于本次读取接口。

## 2026-10-09

### Agent 的适用范围
如果问题只要查一条记录，直接检索即可；需要比较多天记录时，再让 Agent 补查。Agent 不应直接保存学习日志。
`);
const mcp = await startHttpServer({ logRoot: data, indexRoot: path.join(root, "index"), port: 0, token: "synthetic", retrieval: { embedding: { apiKey: "" }, reranker: { apiKey: "" }, rerankEnabled: false } });
const proxy = await startBudgetProxy({ apiKey: process.env.DEEPSEEK_API_KEY, apiUrl: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", budgetCny: 1, ledgerFile: path.join(root, "ledger.jsonl") });
const chat = { baseUrl: proxy.url, apiKey: proxy.token, model: "deepseek-flash" };
const cases = [
  { id: "months", question: "比较2026年9月和10月的学习内容", requiredDates: ["2026-09-02", "2026-09-14", "2026-09-23", "2026-10-03", "2026-10-09"] },
  { id: "negation", question: "为什么读取接口不能在任何失败后都重试？", rubric: "保留只读、有限次数、鉴权失败例外，不推广到支付写入" },
  { id: "reading", question: "为什么回忆流畅并不等于理解正确？", rubric: "陌生概念仍需查证；不虚构个人经历" },
  { id: "absent", question: "为什么我的水稻栽培实验失败了？", rubric: "承认没有依据，不编造实验及原因" }
];
const results = [];
try {
  process.env.RAG_AGENT_TOOL_CALLING_VERIFIED = "true";
  process.env.RAG_JEV_ENABLED = "false";
  for (const entry of cases) for (const route of ["baseline", "agent"]) {
    process.env.RAG_AGENT_ENABLED = String(route === "agent");
    const before = proxy.report().records.length, started = performance.now();
    const raw = await new Response(createRagQueryStream({ question: entry.question, mode: "logs_only", history: [] }, { chat, lightChat: chat, mcp: { url: `http://127.0.0.1:${mcp.address.port}/mcp`, token: "synthetic" } }, new AbortController().signal)).text();
    const events = raw.trim().split("\n\n").filter(Boolean).map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n").slice(1).join("\n").slice(6)) }));
    assert.ok(events.every(event => ["status", "sources", "delta", "done", "error"].includes(event.event)));
    const terminal = events.at(-1);
    const result = { ...entry, route, elapsedMs: Math.round(performance.now() - started), calls: proxy.report().records.length - before, event: terminal.event, ...terminal.data };
    results.push(result);
    await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ model: chat.model, retrieval: "lexical, same fixture for both routes", results, budget: proxy.report(), jev: "not run: no configured credential" }, null, 2));
    console.log(JSON.stringify({ id: entry.id, route, event: result.event, calls: result.calls, elapsedMs: result.elapsedMs, sources: result.citations?.length, code: result.code }));
  }
} finally {
  await proxy.close(); await mcp.close();
  await fs.writeFile(path.join(root, "report.json"), JSON.stringify({ model: chat.model, retrieval: "lexical, same fixture for both routes", results, budget: proxy.report(), jev: "not run: no configured credential" }, null, 2));
}

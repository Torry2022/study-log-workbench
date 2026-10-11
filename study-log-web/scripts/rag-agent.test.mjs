import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startHttpServer } from "../../study-log-mcp/src/http-server.mjs";
import { EvidenceRun } from "../lib/rag-evidence.ts";
import { createAgentModel, supplementEvidence, agentEnabled } from "../lib/rag-agent.ts";
import { judgeEvidence, validateEvidenceJudgment } from "../lib/rag-jev.ts";
import { createRagQueryStream } from "../lib/rag-query.ts";

const config = { baseUrl: "https://example.test/custom/endpoint?version=one", apiKey: "synthetic", model: "mock-tools" };
function stream(tool, args, id = "one") {
  const chunk = delta => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "mock-tools", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  return new Response(chunk({ role: "assistant", content: "内部文本，不可送给用户。" }) + (tool ? chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }) : "") +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rag-agent-fixture-"));
  const logRoot = path.join(root, "data"); await fs.mkdir(logRoot);
  await fs.writeFile(path.join(logRoot, "2026-09_学习日志.md"), "## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。");
  await fs.writeFile(path.join(logRoot, "2026-10_学习日志.md"), Array.from({ length: 31 }, (_, index) => `## 2026-10-${String(index + 1).padStart(2, "0")}\n\n### 合成\n第${index + 1}天的材料。\n`).join("\n"));
  const service = await startHttpServer({ logRoot, indexRoot: path.join(root, "index"), port: 0, token: "synthetic", retrieval: { embedding: { apiKey: "" }, reranker: { apiKey: "" }, rerankEnabled: false } });
  t.after(async () => { await service.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("rag-agent-fixture-")); await fs.rm(root, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${service.address.port}/mcp`, token: "synthetic" };
}
test("SDK tool loop uses exact configured endpoint and real read-only MCP, stopping after two rounds", async t => {
  const mcp = await fixture(t), requests = [], statuses = [];
  const model = createAgentModel(config, async (url, init) => {
    assert.equal(url, config.baseUrl); assert.equal(init.redirect, "error"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic");
    const body = JSON.parse(init.body); requests.push(body);
    return requests.length === 1 ? stream("search", { query: "Alpha" }) : stream("read", { date: "2026-09-01" }, "two");
  });
  const run = new EvidenceRun(new AbortController().signal);
  const usage = await supplementEvidence("Alpha为什么？", { strategy: "relevance", dateFrom: "2026-09-01", dateTo: "2026-09-01" }, run, mcp, model, value => statuses.push(value));
  assert.equal(requests.length, 2); assert.equal(run.calls, 2); assert.equal(run.contexts.length, 2);
  assert.equal(usage.inputTokens, 20); assert.ok(statuses.every(value => !value.includes("内部文本")));
  assert.ok(requests[1].messages.some(message => message.role === "tool"));
  assert.ok(run.contexts.every(item => item.date === "2026-09-01"));
});
test("invalid tool args and nonexistent tools cannot execute reads", async t => {
  const mcp = await fixture(t);
  for (const [name, args] of [["search", { query: 123 }], ["delete", { date: "2026-09-01" }]]) {
    const run = new EvidenceRun(new AbortController().signal);
    await supplementEvidence("question", { strategy: "relevance" }, run, mcp, createAgentModel(config, async () => stream(name, args)), () => {});
    assert.equal(run.calls, 0); assert.equal(run.limited, true);
  }
});
test("empty/no-tool response makes no reads and unknown model capability stays off", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  await supplementEvidence("question", { strategy: "relevance" }, run, {}, createAgentModel(config, async () => stream()), () => {});
  assert.equal(run.calls, 0); assert.equal(agentEnabled({ RAG_AGENT_ENABLED: "true" }), false);
});
test("provider auth and rate failures are errors, not tool capability fallback", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    await assert.rejects(supplementEvidence("question", { strategy: "relevance" }, new EvidenceRun(new AbortController().signal), {}, createAgentModel(config, async () => { calls++; return new Response("private provider body", { status }); }), () => {}), { code: "AGENT_PROVIDER_FAILED" });
    assert.equal(calls, 1);
  }
});
test("cancellation propagates into a stalled model fetch", async () => {
  const controller = new AbortController(); let called;
  const started = new Promise(resolve => { called = resolve; });
  const model = createAgentModel(config, (_url, init) => new Promise((_resolve, reject) => {
    called(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  }));
  const pending = supplementEvidence("question", { strategy: "relevance" }, new EvidenceRun(controller.signal), {}, model, () => {});
  await started; controller.abort(); await assert.rejects(pending);
});
test("Jev rejects invalid choices/probabilities and makes one cancellable request without body logging", async () => {
  const answer = (selected, choices) => ({ type: "choice", choice: selected, confidence: 0.6, probabilities: Object.fromEntries(choices.map(value => [value, value === selected ? 0.8 : 0.1])) });
  const payload = { model: "jev-1.13.0", answers: { support: answer("missing", ["supported", "missing", "uncertain"]), conflict: answer("absent", ["present", "absent", "uncertain"]) }, usage: { input_tokens: 100, output_tokens: 0 } };
  assert.deepEqual(validateEvidenceJudgment(payload), { support: "missing", conflict: "absent" });
  assert.throws(() => validateEvidenceJudgment({ ...payload, answers: { ...payload.answers, support: { ...payload.answers.support, choice: "write" } } }));
  const response = await judgeEvidence("question", [], new AbortController().signal, "synthetic", async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "jev-1.13.0");
    return Response.json(payload);
  });
  assert.equal(response.judgment.support, "missing");
});

test("31-day query supplies every day, returns a bounded cited subset and rereads history source pointers", async t => {
  const mcp = await fixture(t), requests = []; let answer = "最后一天的材料[S31]";
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw)); res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const chat = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "synthetic", model: "mock" };
  const query = async input => (await new Response(createRagQueryStream({ mode: "logs_only", history: [], ...input }, { chat, lightChat: chat, mcp }, new AbortController().signal)).text()).trim().split("\n\n").map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n")[1].slice(6)) }));
  let events = await query({ question: "总结2026年10月" });
  assert.equal(events.at(-1).event, "done"); assert.equal(events.at(-1).data.diagnostics.coverage[0].readDates.length, 31);
  assert.equal(events.at(-1).data.citations.length, 1); assert.equal(events.at(-1).data.citations[0].date, "2026-10-31");
  assert.ok(requests[0].messages.at(-1).content.includes("第31天"));
  assert.ok(events.filter(item => item.event === "sources").every(item => item.data.citations.length <= 30));
  answer = "三个日期的记录[S1]";
  events = await query({ question: "2026年10月1日、2日和3日分别记录了什么？" });
  assert.equal(events.at(-1).event, "done");
  assert.deepEqual(events.at(-1).data.diagnostics.coverage.flatMap(scope => scope.readDates), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.ok(events.at(-1).data.diagnostics.coverage.every(scope => scope.status === "complete"));
  answer = Array.from({ length: 31 }, (_, index) => `[S${index + 1}]`).join(" ");
  events = await query({ question: "总结2026年10月" });
  assert.equal(events.at(-1).event, "error"); assert.equal(events.at(-1).data.code, "RAG_CITATION_LIMIT");
  answer = "重新读取的原文[S1]";
  events = await query({ question: "刚才第二条来源写了什么？", history: [{ role: "assistant", content: "历史回答", sourceRefs: [
    { date: "2026-10-01", fileName: "2026-10_学习日志.md", heading: null, contentHash: "b".repeat(64) },
    { date: "2026-09-01", fileName: "2026-09_学习日志.md", heading: "Alpha", contentHash: "b".repeat(64) }
  ] }] });
  assert.equal(events.at(-1).event, "done"); assert.equal(events.at(-1).data.citations[0].date, "2026-09-01");
  assert.notEqual(events.at(-1).data.citations[0].contentHash, "b".repeat(64));
  assert.match(requests.at(-1).messages.at(-1).content, /Alpha条件成立/);
});

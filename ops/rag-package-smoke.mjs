import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const [payload, root] = process.argv.slice(2);
if (!payload || !root || !path.isAbsolute(payload) || !path.isAbsolute(root)) throw Error("Explicit package and NEW synthetic root required");
await fs.mkdir(root);
const { DesktopManager } = await import(pathToFileURL(path.join(payload, "ops", "desktop", "manager.mjs")));
const node = path.join(payload, "runtime", "node.exe");
const manager = new DesktopManager({ packageRoot: payload, node });
const password = "synthetic-rag-package-password";
let toolRequests = 0;
const model = http.createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  assert.equal(body.model, "synthetic-model");
  const delta = body.tools
    ? { tool_calls: [{ index: 0, id: `call-${++toolRequests}`, type: "function", function: { name: "search", arguments: '{"query":"Alpha"}' } }] }
    : { content: "条件成立才适用[S1]" };
  const frame = value => `data: ${JSON.stringify(value)}\n\n`;
  res.setHeader("content-type", "text/event-stream");
  res.end(frame({ id: "mock", object: "chat.completion.chunk", created: 1, model: "synthetic-model", choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: body.tools ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + "data: [DONE]\n\n");
});
await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
try {
  await manager.select({ root, create: true, password });
  const envFile = path.join(root, ".env");
  const original = await fs.readFile(envFile, "utf8");
  await fs.writeFile(envFile, original.replace(/^CHAT_(?:API_URL|MODEL|API_KEY)=.*\r?\n/gm, "") + `\nCHAT_API_URL=http://127.0.0.1:${model.address().port}/full/custom/endpoint\nCHAT_MODEL=synthetic-model\nCHAT_API_KEY=synthetic\nRAG_AGENT_ENABLED=true\nRAG_AGENT_TOOL_CALLING_VERIFIED=true\nRAG_JEV_ENABLED=false\n`);
  const source = "## 2026-09-01\n\n### Alpha\nAlpha条件成立才适用，不适用于所有场景。\n";
  const file = path.join(root, "data", "2026-09_学习日志.md"); await fs.writeFile(file, source);
  for (const license of ["ai/LICENSE", "@ai-sdk/openai-compatible/LICENSE", "@typesafe-ai/sdk/LICENSE"]) await fs.access(path.join(payload, "web", "node_modules", license));
  const status = await manager.start(); assert.equal(status.state, "running");
  assert.equal((await fetch(status.url)).status, 200);
  const auth = await (await fetch(`${status.url}/api/auth/app-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })).json();
  assert.equal(typeof auth.token, "string");
  const checks = [];
  for (const question of ["总结2026年9月", "Alpha为什么只在条件成立时适用？"]) {
    const response = await fetch(`${status.url}/api/rag/query`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ question, mode: "logs_only", history: [] }) });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n\n").map(block => ({ event: block.split("\n")[0].slice(7), data: JSON.parse(block.split("\n")[1].slice(6)) }));
    assert.equal(events.at(-1).event, "done", JSON.stringify(events.at(-1)));
    assert.equal(events.at(-1).data.citations[0].date, "2026-09-01");
    checks.push({ question, diagnostics: events.at(-1).data.diagnostics });
  }
  assert.ok(toolRequests >= 1); assert.equal(await fs.readFile(file, "utf8"), source);
  await fs.writeFile(path.join(root, "package-check.json"), JSON.stringify({ node: process.version, checks, toolRequests }, null, 2));
  const result = await promisify(execFile)(node, ["ops/browser-rag.mjs", root, status.url], { cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
  console.log(result.stdout);
  console.log("Packaged Node/Web/MCP, bearer-auth SSE, AI SDK exact URL and browser RAG checks passed.");
} finally {
  await manager.shutdown(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}

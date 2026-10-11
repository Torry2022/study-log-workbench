import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EvidenceRun } from "../lib/rag-evidence.ts";
import { compactEvidence } from "../lib/rag-evidence-summary.ts";
import { parseRagHistory } from "../lib/rag-answer.ts";

test("batch synthesis keeps original source identity and marks failed compression as partial", async t => {
  let malformed = false;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const evidence = JSON.parse(JSON.parse(raw).messages[1].content).evidence;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(malformed ? [] : evidence.map(item => ({ sourceId: item.sourceId, content: "仅在条件满足时成立，不代表所有情况。" }))) } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const make = () => { const run = new EvidenceRun(new AbortController().signal); run.contexts = Array.from({ length: 6 }, (_, index) => ({ sourceId: `S${index + 1}`, date: "2026-09-01", content: "原始条件".repeat(1500), excerpt: "原始摘录", contentHash: "a".repeat(64) })); return run; };
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "synthetic", model: "mock" };
  const run = make(); await compactEvidence(run, "条件是什么？", config);
  assert.equal(run.limited, false); assert.equal(run.contexts[5].sourceId, "S6"); assert.equal(run.contexts[0].excerpt, "原始摘录"); assert.equal(run.contexts[0].contentHash, "a".repeat(64));
  malformed = true; const failed = make(); await compactEvidence(failed, "条件是什么？", config);
  assert.equal(failed.limited, true); assert.ok(failed.contexts.every(item => item.truncated && item.content.length === 900));
  const aborted = make(); const controller = new AbortController(); controller.abort();
  await assert.rejects(compactEvidence(Object.assign(aborted, { signal: controller.signal }), "question", config));
});

test("source pointers reject path traversal, mismatched dates and bad numbering without shifting remaining sources", () => {
  const ref = { date: "2026-09-01", fileName: "2026-09_学习日志.md", heading: null, contentHash: "a".repeat(64) };
  const history = sourceRefs => parseRagHistory([{ role: "assistant", content: "回答[S1]", sourceRefs }])[0];
  assert.deepEqual(history([ref]).sourceRefs, [ref]);
  assert.equal(history([{ ...ref, fileName: "../secret" }, ref]).sourceRefs, undefined);
  assert.equal(history([{ ...ref, date: "2026-10-01" }]).sourceRefs, undefined);
});

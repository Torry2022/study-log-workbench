import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBudgetProxy } from "./model-budget-proxy.mjs";

test("cancelled planner stops its upstream, preserves spending reservation and permits the next answer", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-budget-cancel-"));
  const clientFetch = globalThis.fetch;
  let entered, stopped;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { stopped = resolve; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    if (++calls === 1) {
      entered();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => { stopped(); reject(options.signal.reason); }, { once: true });
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "合成回答" } }], usage: { prompt_tokens: 1 } }),
      { headers: { "content-type": "application/json" } });
  };
  let proxy;
  try {
    const ledgerFile = path.join(directory, "reservations.jsonl");
    proxy = await startBudgetProxy({ apiKey: "synthetic", apiUrl: "https://api.deepseek.com/chat/completions",
      model: "deepseek-flash", budgetCny: 1, ledgerFile });
    const options = { method: "POST", headers: { Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "合成" }] }) };
    const controller = new AbortController();
    const planner = clientFetch(proxy.url, { ...options, signal: controller.signal });
    const rejected = assert.rejects(planner, { name: "AbortError" });
    await started;
    const concurrent = await clientFetch(proxy.url, options);
    assert.equal(concurrent.status, 409);
    assert.equal(proxy.report().records.length, 1);
    controller.abort();
    await rejected;
    await Promise.race([aborted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Upstream was not cancelled")), 1000).unref())]);
    const answer = await clientFetch(proxy.url, options);
    assert.equal(answer.status, 200);
    assert.match(await answer.text(), /合成回答/);
    const report = proxy.report();
    assert.equal(report.records.length, 2);
    assert.equal(report.records[0].status, "cancelled");
    assert.equal(report.records[0].usage, null);
    assert.equal(report.reservedCny, report.records.reduce((sum, record) => sum + record.reservedCny, 0));
    const ledger = (await fs.readFile(ledgerFile, "utf8")).trim().split("\n").map(row => JSON.parse(row));
    assert.equal(ledger.length, 2);
    assert.equal(ledger[1].cumulativeReservedCny, report.reservedCny);
  } finally {
    await proxy?.close();
    globalThis.fetch = clientFetch;
    if (path.dirname(directory) === os.tmpdir()) await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bounded proxy forwards completed SSE and reports interrupted upstream without a false completion", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "study-log-budget-proxy-"));
  const clientFetch = globalThis.fetch;
  try {
    for (const interrupted of [false, true]) {
      const body = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "合成回答" } }] })}\n\n`);
      let pull = 0;
      globalThis.fetch = async () => new Response(new ReadableStream({
        pull(controller) {
          if (pull++ === 0) { controller.enqueue(body); return; }
          if (interrupted) controller.error(new Error("synthetic upstream cut"));
          else { controller.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":1}}\n\ndata: [DONE]\n\n')); controller.close(); }
        }
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
      const proxy = await startBudgetProxy({ apiKey: "synthetic", apiUrl: "https://api.deepseek.com/chat/completions",
        model: "deepseek-flash", budgetCny: 1, ledgerFile: path.join(directory, `${interrupted}.jsonl`) });
      try {
        let response;
        try { response = await clientFetch(proxy.url, { method: "POST", headers: {
          Authorization: `Bearer ${proxy.token}`, "Content-Type": "application/json"
        }, body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "合成" }], stream: true }) }); }
        catch (error) { if (!interrupted) throw error; }
        if (response) assert.equal(response.status, 200);
        if (interrupted) {
          if (response) await assert.rejects(response.text());
          assert.equal(proxy.report().records[0].streamFailure, true);
          assert.equal(proxy.report().records[0].usage, null);
        } else {
          assert.ok(response);
          const stream = await response.text();
          assert.match(stream, /合成回答/);
          assert.match(stream, /data: \[DONE\]/);
          assert.equal(proxy.report().records[0].streamFailure, false);
          assert.equal(proxy.report().records[0].usage.prompt_tokens, 1);
        }
        assert.equal((await fs.readFile(path.join(directory, `${interrupted}.jsonl`), "utf8")).trim().split("\n").length, 1);
      } finally { await proxy.close(); }
    }
  } finally {
    globalThis.fetch = clientFetch;
    if (path.dirname(directory) === os.tmpdir()) await fs.rm(directory, { recursive: true, force: true });
  }
});

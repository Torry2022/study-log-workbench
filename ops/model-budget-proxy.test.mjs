import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startBudgetProxy } from "./model-budget-proxy.mjs";

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

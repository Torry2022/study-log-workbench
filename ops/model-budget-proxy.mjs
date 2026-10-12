import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Acceptance-only loopback proxy. Reserve the worst-case charge before every call;
// timed-out/failed calls keep their reservation. Never retries or logs credentials.
export async function startBudgetProxy({ apiKey, apiUrl, model, budgetCny, ledgerFile, reasoningEffort, maxCalls = 16 }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 64) throw new Error("Acceptance call limit must be 1..64");
  if (reasoningEffort !== undefined && !["low", "none"].includes(reasoningEffort)) throw new Error("Unsupported acceptance reasoning effort");
  if (!apiKey || !model || !apiUrl) throw new Error("Explicit real-model test configuration is required");
  if (!Number.isFinite(budgetCny) || budgetCny <= 0 || !ledgerFile || !path.isAbsolute(ledgerFile)) throw new Error("Explicit remaining budget and NEW absolute ledger path required");
  const target = new URL(apiUrl);
  if (target.protocol !== "https:") throw new Error("Real-model upstream must use HTTPS");
  if (target.origin !== "https://api.deepseek.com" || target.pathname !== "/chat/completions" || model !== "deepseek-flash") {
    throw new Error("This acceptance budget has only been reviewed for DeepSeek Flash at its official chat endpoint");
  }
  const ledger = await fs.open(ledgerFile, "wx", 0o600);
  const localToken = crypto.randomBytes(24).toString("base64url");
  const records = [];
  const rejectedRequests = [];
  let reservedCny = 0, budgetedCny = 0;
  let inFlight = false;
  let completion = Promise.resolve();
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions" || request.headers.authorization !== `Bearer ${localToken}`) {
      response.writeHead(403).end(); return;
    }
    if (inFlight) { response.writeHead(409).end(); return; }
    inFlight = true;
    await completion;
    let complete;
    completion = new Promise(resolve => { complete = resolve; });
    const started = performance.now();
    let record = null;
    const disconnected = new AbortController();
    const onClose = () => { if (!response.writableFinished) disconnected.abort(); };
    response.on("close", onClose);
    try {
      const buffers = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 64_000) throw new Error("Acceptance request too large"); buffers.push(chunk); }
      const payload = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      if (payload.model !== model || records.length >= maxCalls) throw new Error("Acceptance model or call limit exceeded");
      // Preserve smaller per-stage limits (the evidence agent requests only 1200).
      const maxTokens = Number.isSafeInteger(payload.max_tokens) && payload.max_tokens > 0 ? Math.min(payload.max_tokens, 8192) : 8192;
      // Conservative test ceilings: CNY 5/M input and 20/M output, above the
      // verified Flash peak price on 2026-09-22. Input UTF-8 bytes plus protocol
      // allowance overestimates token count. Recheck rates before reusing later.
      const reservation = ((bytes + 4096) * 5 + maxTokens * 20) / 1_000_000;
      if (budgetedCny + reservation > budgetCny) throw new Error("Acceptance budget exhausted before request");
      reservedCny += reservation; budgetedCny += reservation;
      record = { request: records.length + 1, reservedCny: reservation, status: "started", usage: null, streamFailure: false, receivedBytes: 0, firstByteMs: null, failure: null };
      records.push(record);
      // Persist the reservation BEFORE issuing a paid request. A process crash
      // or failed request never returns this amount to the available budget.
      await ledger.write(`${JSON.stringify({ ...record, cumulativeReservedCny: reservedCny, cumulativeBudgetedCny: budgetedCny })}\n`); await ledger.sync();
      payload.max_tokens = maxTokens;
      if (reasoningEffort === "none") payload.thinking = { type: "disabled" };
      else if (reasoningEffort) payload.reasoning_effort = reasoningEffort;
      if (payload.stream) payload.stream_options = { include_usage: true };
      const upstream = await fetch(target, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(120_000)]) });
      record.status = String(upstream.status);
      if (!upstream.ok) { await upstream.body?.cancel(); response.writeHead(upstream.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` })); return; }
      response.writeHead(200, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      let collected = "";
      const decoder = new TextDecoder();
      for await (const chunk of upstream.body) {
        record.firstByteMs ??= Math.round(performance.now() - started);
        record.receivedBytes += chunk.byteLength;
        collected += decoder.decode(chunk, { stream: true });
        if (record.receivedBytes > 16 * 1024 * 1024) { record.failure = "response_limit"; throw new Error("Acceptance response too large"); }
        response.write(chunk);
        // SSE completion need not coincide with the upstream TCP connection closing.
        if (payload.stream && /(?:^|\r?\n)data: \[DONE\]\r?\n\r?\n/.test(collected)) break;
      }
      collected += decoder.decode();
      if (payload.stream) {
        record.streamCounts = { frames: 0, answerChars: 0, reasoningChars: 0 };
        for (const line of collected.split("\n")) if (line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]") {
          try {
            const item = JSON.parse(line.slice(6)); if (item.usage) record.usage = item.usage;
            record.streamCounts.frames++;
            const delta = item.choices?.[0]?.delta;
            if (typeof delta?.content === "string") record.streamCounts.answerChars += delta.content.length;
            if (typeof delta?.reasoning_content === "string") record.streamCounts.reasoningChars += delta.reasoning_content.length;
          } catch {}
        }
      } else { try { record.usage = JSON.parse(collected).usage || null; } catch {} }
      const usage = record.usage;
      if ((!payload.stream || collected.includes('data: [DONE]')) &&
          Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && usage.prompt_tokens <= bytes + 4096 &&
          Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0 && usage.completion_tokens <= maxTokens) {
        // Use the same conservative rates as the reservation, not an old tariff.
        // Official 2026-10-11 USD peak prices fit below these at an assumed 10 CNY/USD;
        // this deliberately ignores discounts and is a ceiling, not a supplier bill.
        const ceiling = (usage.prompt_tokens * 5 + usage.completion_tokens * 20) / 1_000_000;
        const settled = budgetedCny - reservation + ceiling;
        await ledger.write(`${JSON.stringify({ ...record, event: 'usage-settled', usageCeilingCny: ceiling,
          cumulativeReservedCny: reservedCny, cumulativeBudgetedCny: settled })}\n`); await ledger.sync();
        record.usageCeilingCny = ceiling; budgetedCny = settled;
      }
      response.end();
    } catch (error) {
      if (!record) {
        const reasons = { "Acceptance budget exhausted before request": "budget_exhausted", "Acceptance model or call limit exceeded": "model_or_call_limit", "Acceptance request too large": "request_size" };
        rejectedRequests.push({ reason: reasons[error?.message] || "invalid_request", elapsedMs: Math.round(performance.now() - started) });
      }
      if (record) {
        // Whitelist transport codes only: never persist error messages, URLs or request bodies.
        const code = error?.cause?.code || error?.code;
        record.failure ??= disconnected.signal.aborted ? "client_cancelled" : error?.name === "TimeoutError" ? "timeout" :
          ["UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ECONNRESET", "ETIMEDOUT"].includes(code) ? code : "transport_error";
      }
      if (disconnected.signal.aborted) { if (record) record.status = "cancelled"; return; }
      if (record && response.headersSent) record.streamFailure = true;
      if (response.headersSent) response.destroy();
      else response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Acceptance proxy rejected or failed the bounded request" }));
    } finally {
      response.off("close", onClose);
      inFlight = false;
      try {
        if (record) {
          record.elapsedMs = Math.round(performance.now() - started);
          await ledger.write(`${JSON.stringify({ ...record, event: "request-finished", cumulativeBudgetedCny: budgetedCny })}\n`);
          await ledger.sync();
        }
      } finally { complete(); }
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/chat/completions`, token: localToken,
    settled: () => completion,
    report: () => ({ budgetCny, reservedCny, budgetedCny, usageCeilingCny: records.reduce((sum, record) => sum + (record.usageCeilingCny ?? 0), 0),
      unsettledReservedCny: records.filter(record => record.usageCeilingCny === undefined).reduce((sum, record) => sum + record.reservedCny, 0),
      records, rejectedRequests, note: "reservedCny is gross historical reservation, not spending. budgetedCny combines settled usage ceilings and unresolved reservations; neither is a supplier bill." }),
    close: async () => { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await completion; await ledger.close(); }
  };
}

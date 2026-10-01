import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Acceptance-only loopback proxy. Reserve the worst-case charge before every call;
// timed-out/failed calls keep their reservation. Never retries or logs credentials.
export async function startBudgetProxy({ apiKey, apiUrl, model, budgetCny, ledgerFile }) {
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
  let reservedCny = 0;
  let inFlight = false;
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions" || request.headers.authorization !== `Bearer ${localToken}`) {
      response.writeHead(403).end(); return;
    }
    if (inFlight) { response.writeHead(409).end(); return; }
    inFlight = true;
    let record = null;
    try {
      const buffers = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 64_000) throw new Error("Acceptance request too large"); buffers.push(chunk); }
      const payload = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      if (payload.model !== model || records.length >= 12) throw new Error("Acceptance model or call limit exceeded");
      const maxTokens = 8192;
      // Conservative test ceilings: CNY 5/M input and 20/M output, above the
      // verified Flash peak price on 2026-09-22. Input UTF-8 bytes plus protocol
      // allowance overestimates token count. Recheck rates before reusing later.
      const reservation = ((bytes + 4096) * 5 + maxTokens * 20) / 1_000_000;
      if (reservedCny + reservation > budgetCny) throw new Error("Acceptance budget exhausted before request");
      reservedCny += reservation;
      record = { request: records.length + 1, reservedCny: reservation, status: "started", usage: null, streamFailure: false };
      records.push(record);
      // Persist the reservation BEFORE issuing a paid request. A process crash
      // or failed request never returns this amount to the available budget.
      await ledger.write(`${JSON.stringify({ ...record, cumulativeReservedCny: reservedCny })}\n`); await ledger.sync();
      payload.max_tokens = maxTokens;
      if (payload.stream) payload.stream_options = { include_usage: true };
      const upstream = await fetch(target, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
      record.status = String(upstream.status);
      if (!upstream.ok) { await upstream.body?.cancel(); response.writeHead(upstream.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` })); return; }
      response.writeHead(200, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      let collected = "";
      for await (const chunk of upstream.body) { collected += Buffer.from(chunk).toString("utf8"); if (collected.length > 2_000_000) throw new Error("Acceptance response too large"); response.write(chunk); }
      response.end();
      if (payload.stream) {
        for (const line of collected.split("\n")) if (line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]") {
          try { const item = JSON.parse(line.slice(6)); if (item.usage) record.usage = item.usage; } catch {}
        }
      } else { try { record.usage = JSON.parse(collected).usage || null; } catch {} }
    } catch {
      if (record && response.headersSent) record.streamFailure = true;
      if (response.headersSent) response.destroy();
      else response.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Acceptance proxy rejected or failed the bounded request" }));
    } finally { inFlight = false; }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/chat/completions`, token: localToken,
    report: () => ({ budgetCny, reservedCny, records, note: "Reservation is a conservative ceiling, not a statement of actual billing." }),
    close: async () => { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); await ledger.close(); }
  };
}

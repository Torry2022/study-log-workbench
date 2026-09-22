#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createRuntime, createStudyLogServer, MAX_REQUEST_BYTES, safeLog, installShutdown, parseArgs } from "./server.mjs";

const localHosts = ["localhost", "127.0.0.1", "[::1]", "study-log-mcp"];
function hostnames(value) {
  const list = typeof value === "string" ? value.split(",").map(item => item.trim()) : value;
  if (!Array.isArray(list) || !list.length || list.some(item => {
    if (typeof item !== "string" || !item || /[\s/@?#\\]/.test(item)) return true;
    try { const url = new URL(`http://${item}`); return url.hostname !== item.toLowerCase() || !!url.port; } catch { return true; }
  })) throw new Error("Allowed hosts must be explicit hostnames without schemes or ports.");
  return list.map(item => item.toLowerCase());
}
function reply(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error }));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const cleanup = () => { clearTimeout(timer); req.removeListener("data", data); req.removeListener("end", end); req.removeListener("error", failed); req.removeListener("aborted", aborted); };
    const fail = (status, message) => { cleanup(); req.resume(); reject(Object.assign(new Error(message), { status })); };
    const data = chunk => { bytes += chunk.length; if (bytes > MAX_REQUEST_BYTES) fail(413, "Request body too large."); else chunks.push(chunk); };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(Object.assign(new Error("Invalid JSON body."), { status: 400 })); }
    };
    const failed = () => fail(400, "Request body unavailable."); const aborted = () => fail(400, "Request cancelled.");
    const timer = setTimeout(() => fail(408, "Request body timed out."), 10000);
    req.on("data", data); req.once("end", end); req.once("error", failed); req.once("aborted", aborted);
  });
}

export async function startHttpServer(options = {}) {
  const token = options.token ?? process.env.MCP_HTTP_TOKEN;
  if (typeof token !== "string" || !token || token.trim() !== token || /[^\x21-\x7e]/.test(token)) throw new Error("MCP_HTTP_TOKEN is required and must contain only non-space ASCII characters.");
  const host = options.host ?? process.env.MCP_HTTP_HOST ?? "127.0.0.1";
  const port = Number(options.port ?? process.env.MCP_HTTP_PORT ?? 3020);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid HTTP port.");
  const validateHost = hostHeaderValidation(hostnames(options.allowedHosts ?? process.env.MCP_HTTP_ALLOWED_HOSTS ?? localHosts));
  const validateOrigin = originValidation(hostnames(options.allowedOrigins ?? process.env.MCP_HTTP_ALLOWED_ORIGINS ?? localHosts));
  const expected = crypto.createHash("sha256").update(`Bearer ${token}`).digest();
  const runtime = await createRuntime(options);
  const entry = createMcpHandler(context => createStudyLogServer(runtime, context.requestInfo?.signal), { legacy: "stateless", responseMode: "auto", onerror: safeLog });
  const handle = toNodeHandler(entry, { onerror: safeLog });
  let closing;
  const active = new Set();
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, (req, res) => {
    // Drain rejected input without retaining it, so an early 401/413 can reach
    // a client that is still sending its request instead of racing a reset.
    res.once("finish", () => { if (!req.complete) req.resume(); });
    const work = (async () => {
      res.setHeader("Cache-Control", "no-store");
      if (closing) return reply(res, 503, "Service is stopping.");
      for (const name of ["host", "origin", "authorization"]) {
        if (req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length > 1) return reply(res, 400, "Duplicate security header.");
      }
      if (!/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(req.headers.host ?? "")) return reply(res, 403, "Invalid Host.");
      if (req.headers.origin !== undefined) {
        try {
          const origin = new URL(req.headers.origin);
          if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== req.headers.origin) return reply(res, 403, "Invalid Origin.");
        } catch { return reply(res, 403, "Invalid Origin."); }
      }
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
      const received = crypto.createHash("sha256").update(req.headers.authorization ?? "").digest();
      if (!crypto.timingSafeEqual(expected, received)) { res.setHeader("WWW-Authenticate", "Bearer"); return reply(res, 401, "Unauthorized."); }
      if (req.url === "/health" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"status":"ok"}'); }
      if (req.url !== "/mcp") return reply(res, 404, "Not found.");
      if (req.method !== "POST") return reply(res, 405, "Method not allowed.");
      if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") return reply(res, 415, "Encoded request bodies are not supported.");
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) return reply(res, 415, "Expected application/json.");
      if (Number(req.headers["content-length"]) > MAX_REQUEST_BYTES) return reply(res, 413, "Request body too large.");
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(res, 400, "Expected one JSON-RPC message.");
      await handle(req, res, body);
    })().catch(error => { if (!res.headersSent && !res.destroyed) reply(res, [400, 408, 413].includes(error?.status) ? error.status : 500, [400, 408, 413].includes(error?.status) ? error.message : "MCP request failed."); else if (!res.destroyed) res.destroy(); });
    active.add(work); work.finally(() => active.delete(work));
  });
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  try { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); }); }
  catch (error) { await entry.close(); await runtime.close(); throw error; }
  return {
    address: server.address(),
    close() { return closing ??= (async () => {
      const stopped = new Promise(resolve => server.close(resolve));
      const runtimeClosed = runtime.close();
      server.closeAllConnections(); await entry.close(); await Promise.allSettled([...active]); await runtimeClosed; await stopped;
    })(); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const handle = await startHttpServer(parseArgs(process.argv.slice(2))); installShutdown(handle); console.error("MCP HTTP ready."); }
  catch { console.error("MCP HTTP startup failed; check token, explicit roots, listener settings and index ownership."); process.exitCode = 1; }
}

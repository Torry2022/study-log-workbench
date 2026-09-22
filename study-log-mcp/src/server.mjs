#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { StudyLogStore } from "./log-store.mjs";
import { SourceError } from "./paths.mjs";
import { checkCancelled, ProviderError } from "./providers.mjs";
import { acquireIndexGuard } from "./index-guard.mjs";
import { tools, validateToolArguments } from "./tools.mjs";
export { tools } from "./tools.mjs";
export const SERVER_INFO = { name: "study-log-mcp", version: "0.1.0" };
export const MAX_REQUEST_BYTES = 1024 * 1024;
export const safeLog = () => console.error("MCP request or transport failed.");

export async function createRuntime(options = {}) {
  const store = new StudyLogStore(options.logRoot, { indexRoot: options.indexRoot, retrieval: options.retrieval });
  await store.listLogFiles();
  const release = store.retriever.embeddingClient.enabled ? await acquireIndexGuard(store.indexRoot) : async () => {};
  const shutdown = new AbortController(), pending = new Set();
  async function execute(name, args, requestSignal) {
    const signal = requestSignal ? AbortSignal.any([shutdown.signal, requestSignal]) : shutdown.signal;
    try {
      checkCancelled(signal); validateToolArguments(name, args);
      let value;
      switch (name) {
        case "list_months": value = { months: await store.listMonths() }; break;
        case "list_days": value = { days: await store.listDays(args.month) }; break;
        case "get_day": value = { day: await store.getDay(args.date, args) }; break;
        case "search_logs": value = { results: await store.searchLogs(args.query, args) }; break;
        case "find_related": value = await store.findRelated(args.input, { ...args, signal }); break;
        case "retrieve_contexts": value = await store.retrieveContexts(args.input, { ...args, signal }); break;
        case "get_recent_context": value = { days: await store.getRecentContext(args) }; break;
        case "get_style_examples": value = { examples: await store.getStyleExamples(args) }; break;
      }
      checkCancelled(signal);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (error) {
      const known = error instanceof SourceError || error instanceof ProviderError;
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: known ? error.message : "Log request failed.", code: known ? error.code : "REQUEST_FAILED" }) }] };
    }
  }
  let closing;
  return {
    callTool(name, args = {}, signal) {
      const task = execute(name, args, signal); pending.add(task); task.finally(() => pending.delete(task)); return task;
    },
    close() { return closing ??= (async () => { shutdown.abort(); await Promise.allSettled([...pending]); await release(); })(); }
  };
}

export function createStudyLogServer(runtime, signal) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: "Read-only original Markdown logs only. Optional explicitly configured embedding/rerank providers receive selected log text; derived vector cache may be updated. No note, Wiki or source-writing tools." });
  server.setRequestHandler("tools/list", async () => ({ tools }));
  server.setRequestHandler("tools/call", (request, context) => runtime.callTool(request.params.name, request.params.arguments ?? {},
    signal ? AbortSignal.any([signal, context.mcpReq.signal]) : context.mcpReq.signal));
  return server;
}

export function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split("=", 2), key = { "--log-root": "logRoot", "--index-root": "indexRoot" }[name];
    if (!key) throw new Error("Unknown command line option.");
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) throw new Error("Missing directory argument.");
    result[key] = value;
  }
  return result;
}
export async function startStdioServer(options = {}) {
  const runtime = await createRuntime(options);
  try {
    const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: MAX_REQUEST_BYTES });
    const closeTransport = transport.close.bind(transport);
    transport.close = async () => { await runtime.close(); await closeTransport(); };
    const handle = serveStdio(() => createStudyLogServer(runtime), { legacy: "serve", onerror: safeLog,
      transport });
    return { close: async () => { await runtime.close(); await handle.close(); } };
  } catch (error) { await runtime.close(); throw error; }
}
export function installShutdown(handle) {
  let closing = false;
  const close = async () => { if (closing) return; closing = true; try { await handle.close(); } catch { safeLog(); process.exitCode = 1; } };
  process.once("SIGINT", close); process.once("SIGTERM", close); return close;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const handle = await startStdioServer(parseArgs(process.argv.slice(2))); const close = installShutdown(handle);
    process.stdin.once("end", close); console.error("MCP stdio ready.");
  } catch { console.error("MCP startup failed; check explicit roots and index ownership."); process.exitCode = 1; }
}

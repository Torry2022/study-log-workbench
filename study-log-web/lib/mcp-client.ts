import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getMcpConfig, type McpConfig } from "./mcp-config.ts";
import { LOG_FILE_PATTERN } from "./config.ts";
import { isValidLogDate } from "./study-date.ts";
import type { RagRetrievedContext, RagRetrievalStrategy } from "./rag-types.ts";
import type { RagRetrievalPlan } from "./rag-retrieval-plan.ts";

export class McpRetrievalError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) { super(message); this.name = "McpRetrievalError"; this.code = code; this.status = status; }
}
export interface RetrievedContextsResult {
  contexts: RagRetrievedContext[];
  context: { maxChunks: number; maxChars: number; returnedChunks: number; totalChars: number; truncated: boolean; dateFrom?: string | null; dateTo?: string | null; strategy?: RagRetrievalStrategy; matchMode?: "hybrid" | "literal" };
  retrieval?: { mode?: string; strategy?: RagRetrievalStrategy; model?: string | null; dimensions?: number | null; indexUpdatedAt?: string | null };
}
const invalid = () => new McpRetrievalError("MCP_INVALID_RESPONSE", "检索服务返回了无效结果，请检查服务版本或重试");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const strategies = new Set(["relevance", "timeline_summary", "comparison"]);

/** Treat MCP as an external boundary, even when both processes share an instance. */
export function validateRetrievedContexts(value: unknown, limits = { maxChunks: 20, maxChars: 30000 }): RetrievedContextsResult {
  if (!record(value) || !Array.isArray(value.contexts) || value.contexts.length > limits.maxChunks || !record(value.context)) throw invalid();
  const ids = new Set<string>();
  let totalChars = 0;
  const contexts = value.contexts.map((item): RagRetrievedContext => {
    if (!record(item) || !text(item.sourceId, 16) || !/^S[1-9]\d*$/.test(item.sourceId) || ids.has(item.sourceId) ||
      !text(item.date, 10) || !isValidLogDate(item.date) || item.month !== item.date.slice(0, 7) ||
      !text(item.fileName, 80) || !LOG_FILE_PATTERN.test(item.fileName) ||
      !(item.heading === null && item.headingIndex === null || typeof item.heading === "string" && item.heading.length <= 4000 && integer(item.headingIndex, 0, 100000)) ||
      !text(item.chunkId, 512) || !text(item.contentHash, 64) || !/^[a-f0-9]{64}$/i.test(item.contentHash) ||
      !text(item.content, limits.maxChars) || typeof item.truncated !== "boolean" || typeof item.score !== "number" || !Number.isFinite(item.score) ||
      item.sourceType !== undefined || (item.excerpt !== undefined && (typeof item.excerpt !== "string" || item.excerpt.length > 4000))) throw invalid();
    const fileMatch = item.fileName.match(LOG_FILE_PATTERN)!;
    if (item.date.slice(0, 4) !== fileMatch[1] || fileMatch[2] && item.date.slice(5, 7) !== fileMatch[2]) throw invalid();
    ids.add(item.sourceId); totalChars += item.content.length;
    if (totalChars > limits.maxChars) throw invalid();
    return { sourceId: item.sourceId, date: item.date, month: item.month as string, fileName: item.fileName, heading: item.heading as string | null, headingIndex: item.headingIndex as number | null, chunkId: item.chunkId, contentHash: item.contentHash, content: item.content, truncated: item.truncated, score: item.score, ...(typeof item.excerpt === "string" ? { excerpt: item.excerpt } : {}) };
  });
  const context = value.context;
  if (!integer(context.maxChunks, 1, limits.maxChunks) || !integer(context.maxChars, 1, limits.maxChars) || context.returnedChunks !== contexts.length || context.totalChars !== totalChars || typeof context.truncated !== "boolean" || contexts.length > context.maxChunks || totalChars > context.maxChars) throw invalid();
  for (const field of ["dateFrom", "dateTo"] as const) if (context[field] !== undefined && context[field] !== null && (typeof context[field] !== "string" || !isValidLogDate(context[field]))) throw invalid();
  if (context.strategy !== undefined && !strategies.has(context.strategy as string) || context.matchMode !== undefined && !["literal", "hybrid"].includes(context.matchMode as string)) throw invalid();
  const result: RetrievedContextsResult = { contexts, context: { maxChunks: context.maxChunks, maxChars: context.maxChars, returnedChunks: contexts.length, totalChars, truncated: context.truncated, dateFrom: context.dateFrom as string | null | undefined, dateTo: context.dateTo as string | null | undefined, strategy: context.strategy as RagRetrievalStrategy | undefined, matchMode: context.matchMode as "hybrid" | "literal" | undefined } };
  if (value.retrieval !== undefined) {
    if (!record(value.retrieval)) throw invalid();
    const retrieval = value.retrieval;
    if (retrieval.mode !== undefined && (typeof retrieval.mode !== "string" || !/^[a-z_]{1,80}$/.test(retrieval.mode))) throw invalid();
    if (retrieval.strategy !== undefined && !strategies.has(retrieval.strategy as string)) throw invalid();
    // Only operational metadata needed by the Web diagnostics is exposed.
    result.retrieval = { mode: retrieval.mode as string | undefined, strategy: retrieval.strategy as RagRetrievalStrategy | undefined };
  }
  return result;
}

export async function retrieveStudyLogContexts(input: string, options: RagRetrievalPlan = { strategy: "relevance" }, signal?: AbortSignal, config: McpConfig = getMcpConfig(), timeoutMs = 60000): Promise<RetrievedContextsResult> {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let oversized = false;
  const boundedFetch: typeof fetch = async (url, init) => {
    const requestSignal = init?.signal || (url instanceof Request ? url.signal : undefined);
    const response = await fetch(url, { ...init, redirect: "error", signal: requestSignal ? AbortSignal.any([combined, requestSignal]) : combined });
    if (!response.body) return response;
    const reader = response.body.getReader(); let size = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { controller.close(); reader.releaseLock(); return; }
          size += chunk.value.byteLength;
          if (size > 1024 * 1024) { oversized = true; throw invalid(); }
          controller.enqueue(chunk.value);
        } catch (error) { await reader.cancel().catch(() => {}); controller.error(error); }
      },
      async cancel() { await reader.cancel().catch(() => {}); }
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { Authorization: `Bearer ${config.token}` } }, fetch: boundedFetch, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
  const client = new Client({ name: "study-log-web", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  try {
    combined.throwIfAborted();
    await client.connect(transport, { signal: combined, timeout: Math.min(timeoutMs, 15000) });
    const maxChunks = Math.min(options.maxChunks ?? 8, 20), maxChars = Math.min(options.maxChars ?? 12000, 30000);
    const result = await client.callTool({ name: "retrieve_contexts", arguments: { input, ...options, maxChunks, maxChars } }, { signal: combined, timeout: Math.min(timeoutMs, 45000) });
    combined.throwIfAborted();
    if (result.isError) throw new McpRetrievalError("MCP_TOOL_FAILED", "检索服务未能完成查询，请稍后重试");
    const output = result.structuredContent;
    const block = result.content?.find(item => item.type === "text");
    let value: unknown;
    try { value = output ?? (block?.type === "text" ? JSON.parse(block.text) : null); } catch { throw invalid(); }
    return validateRetrievedContexts(value, { maxChunks, maxChars });
  } catch (error) {
    if (signal?.aborted) throw new McpRetrievalError("MCP_CANCELLED", "已取消检索", 499);
    if (deadline.signal.aborted) throw new McpRetrievalError("MCP_TIMEOUT", "检索服务响应超时，请重试", 504);
    if (oversized) throw invalid();
    if (error instanceof McpRetrievalError) throw error;
    throw new McpRetrievalError("MCP_UNAVAILABLE", "无法完成日志检索，请检查 MCP 配置或稍后重试");
  } finally { clearTimeout(timer); await client.close().catch(() => {}); }
}

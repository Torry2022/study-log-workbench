import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { ChatConfigurationError, getChatConfig, getLightChatConfig } from "@/lib/ai-config";
import { getMcpConfig, McpConfigurationError } from "@/lib/mcp-config";
import { parseRagHistory } from "@/lib/rag-answer";
import { createRagQueryStream } from "@/lib/rag-query";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number, code: string) => Response.json({ error, code }, { status, headers });
export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const reader = request.body?.getReader(); if (!reader) return fail("请输入问题", 400, "RAG_INVALID_INPUT");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 128 * 1024) return fail("问答请求超过大小限制", 413, "RAG_INPUT_TOO_LARGE");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let body;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return fail("请求正文必须是有效 JSON", 400, "RAG_INVALID_INPUT"); }
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 2000) return fail("问题必须为 1 至 2000 字", 400, "RAG_INVALID_INPUT");
    if (body.mode !== undefined && body.mode !== "logs_only" && body.mode !== "logs_and_general") return fail("回答模式无效", 400, "RAG_INVALID_INPUT");
    const config = { chat: getChatConfig(), lightChat: getLightChatConfig(), mcp: getMcpConfig() };
    const stream = createRagQueryStream({ question, history: parseRagHistory(body.history), mode: body.mode || "logs_only" }, config, request.signal);
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    if (error instanceof ChatConfigurationError || error instanceof McpConfigurationError) return fail(error.message, 503, error.code);
    return fail("无法开始问答，请稍后重试", request.signal.aborted ? 499 : 500, request.signal.aborted ? "RAG_CANCELLED" : "RAG_QUERY_FAILED");
  }
}

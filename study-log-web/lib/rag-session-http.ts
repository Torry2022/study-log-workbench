import { RagSessionInputError, RagSessionConflictError, RagSessionNotFoundError } from "./rag-sessions-store.ts";

export const ragSessionHeaders = { "Cache-Control": "no-store" };
export class RagSessionRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code; }
}
export async function readRagSessionBody(request: Request): Promise<unknown> {
  if (request.signal.aborted) throw new RagSessionRequestError("已取消请求，未确认的回答请保留", 499, "RAG_SESSION_CANCELLED");
  const reader = request.body?.getReader();
  if (!reader) throw new RagSessionInputError("请求正文必须是有效JSON对象");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (request.signal.aborted) throw new RagSessionRequestError("已取消请求，未确认的回答请保留", 499, "RAG_SESSION_CANCELLED");
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new RagSessionRequestError("会话请求超过4MiB限制", 413, "RAG_SESSION_BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RagSessionInputError("请求正文必须是有效JSON对象"); }
}
export function ragSessionError(error: unknown): Response {
  const result = error instanceof RagSessionRequestError ? { status: error.status, code: error.code, message: error.message }
    : error instanceof RagSessionInputError ? { status: 400, code: "RAG_SESSION_INVALID_INPUT", message: error.message }
    : error instanceof RagSessionConflictError ? { status: 409, code: error.code, message: error.message }
    : error instanceof RagSessionNotFoundError ? { status: 404, code: "RAG_SESSION_NOT_FOUND", message: error.message }
    : { status: 500, code: "RAG_SESSION_STORAGE_ERROR", message: "问答历史存储异常，请保留当前回答并联系实例维护者" };
  return Response.json({ error: result.message, code: result.code }, { status: result.status, headers: ragSessionHeaders });
}

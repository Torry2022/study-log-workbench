import { NextRequest } from "next/server";
import { requireAuth } from "./auth";
import { parseRagHistory } from "./rag-answer";
import { currentRagTaskRuntime } from "./rag-task-runtime";
import { isRagTaskError, RagTaskError } from "./rag-task-store";
import type { RagTaskSubmission } from "./rag-task-types";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogRoot } from "./config";

export const taskHeaders = { "Cache-Control": "no-store" };
export async function taskAction(request: NextRequest, action: () => Promise<unknown>): Promise<Response> {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const expected = request.headers.get("x-study-log-instance");
    if (expected) {
      const identity = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8"));
      if (identity.id !== expected) throw new RagTaskError("RAG_INSTANCE_CHANGED", "服务器实例已变化，请重新连接工作台；原实例的待确认问答已保留", 409);
    }
    return Response.json(await action(), { headers: taskHeaders });
  }
  catch (error) {
    return Response.json({ error: isRagTaskError(error) ? error.message : "问答任务存储暂不可用，请稍后重试",
      code: isRagTaskError(error) ? error.code : "RAG_TASK_UNAVAILABLE" }, { status: isRagTaskError(error) ? error.status : 503, headers: taskHeaders });
  }
}
export function taskRuntime() {
  const runtime = currentRagTaskRuntime();
  if (!runtime) throw new RagTaskError("RAG_TASK_UNAVAILABLE", "任务执行器尚未就绪，请稍后重试", 503);
  return runtime;
}
export async function taskSubmission(request: NextRequest): Promise<RagTaskSubmission> {
  const reader = request.body?.getReader();
  if (!reader) throw new RagTaskError("RAG_INVALID_INPUT", "请输入问题", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 128 * 1024) throw new RagTaskError("RAG_INPUT_TOO_LARGE", "请求超过大小限制", 413);
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RagTaskError("RAG_INVALID_INPUT", "请求正文必须是JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["submissionId", "sessionId", "baseVersion", "question", "mode", "history", "replaceLast", "retryTaskId"].includes(key)) ||
    typeof body.question !== "string" || !body.question.trim() || body.question.trim().length > 2000 ||
    ![body.submissionId, body.sessionId].every(value => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) ||
    body.baseVersion !== null && (typeof body.baseVersion !== "string" || !/^[a-f0-9]{64}$/.test(body.baseVersion)) ||
    body.history !== undefined && !Array.isArray(body.history) || body.replaceLast !== undefined && typeof body.replaceLast !== "boolean" ||
    body.retryTaskId !== undefined && (typeof body.retryTaskId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.retryTaskId)) ||
    body.mode !== undefined && !["logs_only", "logs_and_general"].includes(body.mode)) throw new RagTaskError("RAG_INVALID_INPUT", "任务请求无效", 400);
  try {
    return { submissionId: body.submissionId.toLowerCase(), sessionId: body.sessionId.toLowerCase(), baseVersion: body.baseVersion,
      question: body.question.trim(), mode: body.mode || "logs_only", history: parseRagHistory(body.history), ...(body.replaceLast === true ? { replaceLast: true } : {}),
      ...(body.retryTaskId ? { retryTaskId: body.retryTaskId.toLowerCase() } : {}) };
  } catch { throw new RagTaskError("RAG_INVALID_INPUT", "历史问答格式无效", 400); }
}

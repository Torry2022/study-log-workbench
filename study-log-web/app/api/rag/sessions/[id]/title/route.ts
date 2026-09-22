import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { AiChatError } from "@/lib/ai-chat";
import { ChatConfigurationError } from "@/lib/ai-config";
import { generateRagSessionTitle } from "@/lib/rag-session-title";
import { applyGeneratedRagSessionTitle, getRagSession, RagSessionConflictError, RagSessionInputError } from "@/lib/rag-sessions-store";
import { ragSessionError, ragSessionHeaders, readRagSessionBody } from "@/lib/rag-session-http";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try {
    const input = await readRagSessionBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "baseVersion") || !("baseVersion" in input) || typeof input.baseVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.baseVersion)) throw new RagSessionInputError("生成标题必须提供有效的baseVersion");
    const id = (await context.params).id, session = await getRagSession(id);
    if (session.titleSource !== "fallback") return Response.json({ session }, { headers: ragSessionHeaders });
    if (session.version !== input.baseVersion) throw new RagSessionConflictError();
    const title = await generateRagSessionTitle(session.messages[0].content, request.signal);
    return Response.json({ session: await applyGeneratedRagSessionTitle(id, session.version, title) }, { headers: ragSessionHeaders });
  } catch (error) {
    if (error instanceof ChatConfigurationError) return Response.json({ error: "自动标题尚未配置，会话正文已保留", code: error.code }, { status: 503, headers: ragSessionHeaders });
    if (error instanceof AiChatError) return Response.json({ error: error.code === "AI_CANCELLED" ? "已取消标题生成，会话正文已保留" : "自动标题生成失败，会话正文已保留", code: error.code }, { status: error.status, headers: ragSessionHeaders });
    return ragSessionError(error);
  }
}

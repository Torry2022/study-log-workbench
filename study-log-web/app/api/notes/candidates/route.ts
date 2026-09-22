import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { AiChatError } from "@/lib/ai-chat";
import { ChatConfigurationError } from "@/lib/ai-config";
import { WritingPromptError } from "@/lib/ai-prompts";
import { listStudyNotes } from "@/lib/notes-store";
import { extractStudyNoteCandidates, validateCandidateDocuments, NoteCandidateInputError } from "@/lib/note-candidates";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "请提供已解析的材料 JSON" }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) return Response.json({ error: "提取请求超过大小限制" }, { status: 413, headers });
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let input;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers }); }
    const documents = validateCandidateDocuments(input?.documents);
    const tags = (await listStudyNotes()).tags;
    return Response.json({ result: await extractStudyNoteCandidates(documents, tags, request.signal) }, { headers });
  } catch (error) {
    if (error instanceof NoteCandidateInputError) return Response.json({ error: error.message }, { status: 400, headers });
    if (error instanceof ChatConfigurationError || error instanceof WritingPromptError) return Response.json({ error: error.message, code: error.code }, { status: 503, headers });
    if (error instanceof AiChatError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    return Response.json({ error: "候选提取失败，请检查实例配置或稍后重试" }, { status: 500, headers });
  }
}

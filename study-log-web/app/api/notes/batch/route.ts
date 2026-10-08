import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createStudyNotes } from "@/lib/notes-store";
import { NoteConflictError, NoteFormatError, NoteInputError, NoteRecoveryError } from "@/lib/notes-types";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) return Response.json({ error: "批量保存请求超过大小限制" }, { status: 413, headers });
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let input;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers }); }
    return Response.json({ notes: await createStudyNotes(input?.notes) }, { headers });
  } catch (error) {
    if (error instanceof NoteConflictError) return Response.json({ error: error.message, code: "NOTE_CONFLICT" }, { status: 409, headers });
    if (error instanceof NoteInputError) return Response.json({ error: error.message }, { status: 400, headers });
    if (error instanceof NoteRecoveryError) return Response.json({ error: error.message, code: "NOTES_RECOVERY_REQUIRED" }, { status: 503, headers });
    if (error instanceof NoteFormatError) return Response.json({ error: error.message }, { status: 500, headers });
    return Response.json({ error: "批量保存失败，请保留候选并检查存储状态后重试" }, { status: 500, headers });
  }
}

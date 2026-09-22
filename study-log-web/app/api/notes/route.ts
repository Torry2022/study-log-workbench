import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createStudyNote, deleteStudyNote, listStudyNotes, updateStudyNote } from "@/lib/notes-store";
import { NoteConflictError, NoteFormatError, NoteInputError, NoteNotFoundError, NoteRecoveryError } from "@/lib/notes-types";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown): Response {
  if (error instanceof NoteConflictError) return Response.json({ error: error.message, code: "NOTE_CONFLICT" }, { status: 409, headers });
  if (error instanceof NoteInputError) return Response.json({ error: error.message }, { status: 400, headers });
  if (error instanceof NoteNotFoundError) return Response.json({ error: error.message }, { status: 404, headers });
  if (error instanceof NoteRecoveryError) return Response.json({ error: error.message, code: "NOTES_RECOVERY_REQUIRED" }, { status: 503, headers });
  if (error instanceof NoteFormatError) return Response.json({ error: error.message }, { status: 500, headers });
  return Response.json({ error: "随记存储操作失败，请保留当前草稿并检查实例存储后重试" }, { status: 500, headers });
}
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try { return Response.json(await listStudyNotes(), { headers }); } catch (error) { return failure(error); }
}
async function mutate(request: NextRequest, operation: (body: any) => Promise<unknown>) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "请求正文必须是对象" }, { status: 400, headers });
  try { return Response.json(await operation(body), { headers }); } catch (error) { return failure(error); }
}
export function POST(request: NextRequest) { return mutate(request, async body => ({ note: await createStudyNote(body) })); }
export function PATCH(request: NextRequest) { return mutate(request, async body => ({ note: await updateStudyNote(body) })); }
export function DELETE(request: NextRequest) {
  return mutate(request, async body => { await deleteStudyNote(body.id, body.baseVersion); return { ok: true }; });
}

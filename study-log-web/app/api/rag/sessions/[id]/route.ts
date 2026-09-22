import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { deleteRagSession, getRagSession, renameRagSession, updateRagSession, type DeleteRagSessionInput, type RenameRagSessionInput, type SaveRagSessionInput } from "@/lib/rag-sessions-store";
import { ragSessionError, ragSessionHeaders, readRagSessionBody } from "@/lib/rag-session-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { return Response.json({ session: await getRagSession((await context.params).id) }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}
export async function PUT(request: NextRequest, context: Context) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { return Response.json({ session: await updateRagSession((await context.params).id, await readRagSessionBody(request) as SaveRagSessionInput) }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { return Response.json({ session: await renameRagSession((await context.params).id, await readRagSessionBody(request) as RenameRagSessionInput) }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}
export async function DELETE(request: NextRequest, context: Context) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { await deleteRagSession((await context.params).id, await readRagSessionBody(request) as DeleteRagSessionInput); return Response.json({ ok: true }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}

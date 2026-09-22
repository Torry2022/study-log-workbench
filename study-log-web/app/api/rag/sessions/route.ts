import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createRagSession, listRagSessions, type CreateRagSessionInput } from "@/lib/rag-sessions-store";
import { ragSessionError, ragSessionHeaders, readRagSessionBody } from "@/lib/rag-session-http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { return Response.json({ sessions: await listRagSessions(request.nextUrl.searchParams.get("q") || "") }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}
export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) { unauthorized.headers.set("Cache-Control", "no-store"); return unauthorized; }
  try { return Response.json({ session: await createRagSession(await readRagSessionBody(request) as CreateRagSessionInput) }, { headers: ragSessionHeaders }); }
  catch (error) { return ragSessionError(error); }
}

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { restoreDayBackup } from "@/lib/day-backup-store";
import { dayBackupHeaders, dayBackupErrorResponse } from "@/lib/day-backup-response";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers: dayBackupHeaders }); }
  try { return Response.json({ day: await restoreDayBackup(body) }, { headers: dayBackupHeaders }); }
  catch (error) { return dayBackupErrorResponse(error); }
}

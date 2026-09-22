import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listDayBackups } from "@/lib/day-backup-store";
import { dayBackupHeaders, dayBackupErrorResponse } from "@/lib/day-backup-response";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const backup = await listDayBackups(request.nextUrl.searchParams.get("date") || "", request.nextUrl.searchParams.get("cursor") ?? undefined);
    return Response.json({ backup }, { headers: dayBackupHeaders });
  } catch (error) { return dayBackupErrorResponse(error); }
}

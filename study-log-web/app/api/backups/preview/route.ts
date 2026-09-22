import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { previewDayBackup } from "@/lib/day-backup-store";
import { dayBackupHeaders, dayBackupErrorResponse } from "@/lib/day-backup-response";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const params = request.nextUrl.searchParams;
    const preview = await previewDayBackup(params.get("date") || "", params.get("kind") || "", params.get("id") || "");
    return Response.json({ preview }, { headers: dayBackupHeaders });
  } catch (error) { return dayBackupErrorResponse(error); }
}

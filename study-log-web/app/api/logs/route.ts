import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { logReadResponse } from "@/lib/log-read-response";
import { listDays } from "@/lib/log-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const month = request.nextUrl.searchParams.get("month") || "";
  return logReadResponse("/api/logs", async () => ({ days: await listDays(month) }), 400);
}

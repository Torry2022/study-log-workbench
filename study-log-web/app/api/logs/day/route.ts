import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDay } from "@/lib/log-store";
import { logReadResponse } from "@/lib/log-read-response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const date = request.nextUrl.searchParams.get("date") || "";
  return logReadResponse("/api/logs/day", async () => ({ day: await getDay(date) }), 400);
}

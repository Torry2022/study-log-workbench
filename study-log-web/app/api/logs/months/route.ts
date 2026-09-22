import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { logReadResponse } from "@/lib/log-read-response";
import { listMonths } from "@/lib/log-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  return logReadResponse("/api/logs/months", async () => ({ months: await listMonths() }));
}

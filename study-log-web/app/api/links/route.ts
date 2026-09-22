import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { searchInternalLinkCandidates } from "@/lib/internal-link-search";
import { logReadResponse } from "@/lib/log-read-response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const query = request.nextUrl.searchParams.get("query") || "";
  if (query.length > 500) {
    return NextResponse.json({ error: "搜索文字不能超过 500 个字符" }, {
      status: 400, headers: { "Cache-Control": "no-store" }
    });
  }
  return logReadResponse("/api/links", async () => ({ results: await searchInternalLinkCandidates(query) }));
}

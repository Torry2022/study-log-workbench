import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { searchInternalLinkCandidates } from "@/lib/internal-link-search";
import { logReadResponse } from "@/lib/log-read-response";
import { isValidLogDate } from "@/lib/study-date";

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
  const limit = Number(request.nextUrl.searchParams.get("limit") || "40");
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 80) : 40;
  const offset = Number(request.nextUrl.searchParams.get("offset") || "0");
  const date = request.nextUrl.searchParams.get("date") || undefined;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "分页位置无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (date && !isValidLogDate(date)) {
    return NextResponse.json({ error: "日期无效，请选择有效日期" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return logReadResponse("/api/links", async () => {
    const results = await searchInternalLinkCandidates(query, safeLimit + 1, {
      ignoreCase: request.nextUrl.searchParams.get("ignoreCase") !== "false",
      headingsOnly: request.nextUrl.searchParams.get("scope") === "heading",
      date,
      offset
    });
    return { results: results.slice(0, safeLimit), hasMore: results.length > safeLimit };
  });
}

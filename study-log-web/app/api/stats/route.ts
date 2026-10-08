import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { assertMonth, getDefaultStatsMonth, getMonthlyStats } from "@/lib/stats-store";
import { TaxonomyInputError } from "@/lib/taxonomy-store";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store" };
  try {
    const month = request.nextUrl.searchParams.get("month") || await getDefaultStatsMonth();
    assertMonth(month);
    return Response.json({ stats: await getMonthlyStats(month) }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof TaxonomyInputError ? error.message : "统计读取失败，请检查相关文件后重试" },
      { status: error instanceof TaxonomyInputError ? 400 : 500, headers });
  }
}

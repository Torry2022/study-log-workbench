import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { calculateTaxonomyCatalog, parseStatsDays } from "@/lib/stats-store";
import { listSavedDayContents } from "@/lib/log-store";
import { readTaxonomy, writeTaxonomy, TaxonomyConflictError, TaxonomyInputError } from "@/lib/taxonomy-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const [taxonomy, blocks] = await Promise.all([readTaxonomy(), listSavedDayContents()]);
    return Response.json({ taxonomy, catalog: calculateTaxonomyCatalog(parseStatsDays(blocks), taxonomy) }, { headers });
  } catch { return Response.json({ error: "分类读取失败，请检查实例文件后重试" }, { status: 500, headers }); }
}
export async function PUT(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  let input;
  try { input = await request.json(); }
  catch { return Response.json({ error: "请求正文必须是有效JSON" }, { status: 400, headers }); }
  try { return Response.json({ taxonomy: await writeTaxonomy(input) }, { headers }); }
  catch (error) {
    if (error instanceof TaxonomyConflictError) return Response.json({ error: error.message, code: "TAXONOMY_CONFLICT" }, { status: 409, headers });
    return Response.json({ error: error instanceof TaxonomyInputError ? error.message : "分类保存失败，请检查实例存储后重试" },
      { status: error instanceof TaxonomyInputError ? 400 : 500, headers });
  }
}

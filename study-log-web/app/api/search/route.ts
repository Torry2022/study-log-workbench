import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { searchLogs } from "@/lib/log-search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store" };
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "all";
  const ignoreCase = params.get("ignoreCase") ?? "true";
  if (!["all", "heading"].includes(scope) || !["true", "false"].includes(ignoreCase)) {
    return Response.json({ error: "搜索范围或大小写参数无效" }, { status: 400, headers });
  }
  try {
    return Response.json({ results: await searchLogs(params.get("q") || "", {
      ignoreCase: ignoreCase !== "false", headingsOnly: scope === "heading"
    }) }, { headers });
  } catch {
    return Response.json({ error: "搜索失败，请检查日志源文件后重试" }, { status: 500, headers });
  }
}

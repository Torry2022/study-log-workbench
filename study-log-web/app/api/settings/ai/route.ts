import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { summarizeAiSettings } from "@/lib/ai-settings-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Read-only until the separate remote authority and outbound policy are approved. */
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const identity = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8"));
    if (identity.schemaVersion !== 1 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(identity.id || "")) throw new Error("Invalid identity");
    const expected = request.headers.get("x-study-log-instance");
    if (expected && expected !== identity.id) return Response.json({ code: "AI_SETTINGS_INSTANCE_CHANGED", error: "工作台身份已变化，请重新连接" }, { status: 409, headers });
    return Response.json(summarizeAiSettings(identity.id, process.env), { headers });
  } catch {
    return Response.json({ code: "AI_CONFIGURATION_INVALID", error: "模型设置无法读取，请检查工作台配置" }, { status: 503, headers });
  }
}

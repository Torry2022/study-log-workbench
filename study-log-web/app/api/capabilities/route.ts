import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { inspectChatConfig } from "@/lib/ai-config";
import { inspectWritingPrompts } from "@/lib/ai-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const instance = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8"));
    if (instance.schemaVersion !== 1 || typeof instance.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(instance.id)) throw new Error("Invalid identity");
    const provider = inspectChatConfig();
    const templates = await inspectWritingPrompts();
    return NextResponse.json({
      instanceId: instance.id,
      apiContractVersion: 1,
      aiConfiguration: { provider, templates },
      features: {
        aiWriting: { supported: true, configured: provider.configured && templates.generation.configured },
        rag: { supported: false, configured: false }
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "实例尚未正确初始化" }, { status: 503 });
  }
}

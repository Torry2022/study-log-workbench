import packageInfo from "../../../package.json";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { ChatConfigurationError, inspectChatConfig, inspectRagChatConfig, snapshotAiEnvironment } from "@/lib/ai-config";
import { inspectWritingPrompts } from "@/lib/ai-prompts";
import { inspectMcpConfig } from "@/lib/mcp-config";
import { currentRagTaskRuntime } from "@/lib/rag-task-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const instance = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8"));
    if (instance.schemaVersion !== 1 || typeof instance.id !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(instance.id)) throw new Error("Invalid identity");
    let provider: ReturnType<typeof inspectChatConfig>, ragProvider: ReturnType<typeof inspectRagChatConfig>;
    try {
      const env = snapshotAiEnvironment();
      provider = inspectChatConfig(env); ragProvider = inspectRagChatConfig(env);
    } catch (error) {
      if (!(error instanceof ChatConfigurationError)) throw error;
      provider = { configured: false, issues: error.issues }; ragProvider = provider;
    }
    const templates = await inspectWritingPrompts();
    return NextResponse.json({
      instanceId: instance.id,
      apiContractVersion: 1,
      serverVersion: packageInfo.version,
      settings: { ai: { protocolVersion: 1, readable: provider.issues.every(issue => issue.field !== "AI_SETTINGS"), writable: false,
        reason: provider.issues.some(issue => issue.field === "AI_SETTINGS") ? "config_unavailable" : "deployment_managed", reauthRequired: true } },
      aiConfiguration: { provider, templates },
      features: {
        ragTasks: { supported: true, configured: Boolean(currentRagTaskRuntime()), protocolVersion: 1, questionEditing: true },
        aiWriting: { supported: true, configured: provider.configured && templates.generation.configured },
        aiHighlighting: { supported: true, configured: provider.configured && templates.highlighting.configured },
        aiNoteExtraction: { supported: true, configured: provider.configured && templates.extraction.configured },
        aiTaxonomy: { supported: true, configured: provider.configured },
        rag: { supported: true, configured: ragProvider.configured && inspectMcpConfig().configured, issues: ragProvider.issues }
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "工作台尚未完成初始化" }, { status: 503 });
  }
}

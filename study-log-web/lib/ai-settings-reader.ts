import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { aiSettingsIdPattern as id, parseAiSettings } from "./ai-settings-schema.mjs";

/** Read the committed file once; never return a partial or malformed record. */
export function readAiSettingsRecord(root: string, instanceId: string): { instanceId: string; revision: number; operationId: string | null; values: Record<string, string> } {
  if (!path.isAbsolute(root) || !id.test(instanceId)) throw new Error("模型设置路径或工作台身份无效");
  const file = path.join(path.resolve(root), "ai-settings.json");
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("模型设置路径不能包含目录联接");
  }
  return parseAiSettings(readFileSync(file, "utf8"), instanceId);
}

export function readCommittedAiSettings(root: string, instanceId: string): Record<string, string> {
  return readAiSettingsRecord(root, instanceId).values;
}

/** Only a provider origin, never the custom path, query or a credential. */
export function summarizeAiSettings(instanceId: string, env: Record<string, string | undefined>) {
  const root = env.AI_SETTINGS_ROOT;
  const stored = root ? readAiSettingsRecord(root, instanceId) : null;
  const values = stored?.values ?? env;
  const endpoint = values.CHAT_API_URL || "";
  let endpointDisplay = "";
  try { const url = new URL(endpoint); if (["http:", "https:"].includes(url.protocol)) endpointDisplay = url.origin; } catch { /* Invalid legacy settings are not shown. */ }
  return {
    instanceId, revision: stored?.revision ?? null, operationId: stored?.operationId ?? null,
    provider: endpoint === "https://api.deepseek.com/chat/completions" ? "deepseek" : "custom",
    endpointDisplay, hasEndpoint: Boolean(endpoint), model: values.CHAT_MODEL || "", hasKey: Boolean(values.CHAT_API_KEY),
    lightModel: values.CHAT_LIGHT_MODEL || "", contextWindowTokens: values.RAG_CONTEXT_WINDOW_TOKENS || "",
    thinking: values.RAG_DEEPSEEK_THINKING || "", toolCallingVerified: values.RAG_AGENT_TOOL_CALLING_VERIFIED === "true",
    statusVerificationEnabled: values.RAG_STATUS_VERIFICATION_ENABLED === "true",
    source: stored ? "instance" : "deployment"
  };
}

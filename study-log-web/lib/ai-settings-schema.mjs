export const aiSettingsFields = ["CHAT_API_URL", "CHAT_MODEL", "CHAT_API_KEY", "CHAT_LIGHT_MODEL",
  "RAG_CONTEXT_WINDOW_TOKENS", "RAG_DEEPSEEK_THINKING", "RAG_AGENT_TOOL_CALLING_VERIFIED", "RAG_STATUS_VERIFICATION_ENABLED"];
export const aiSettingsIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/** Parse the same complete on-disk format in writers and task readers. */
export function parseAiSettings(bytes, expectedInstanceId) {
  let value;
  try { value = JSON.parse(bytes); } catch { throw new Error("Invalid AI settings"); }
  if (!value || value.schemaVersion !== 1 || !aiSettingsIdPattern.test(value.instanceId || "") ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      (value.remoteManaged !== undefined && typeof value.remoteManaged !== "boolean") ||
      (value.operationId !== null && !aiSettingsIdPattern.test(value.operationId || "")) ||
      !value.values || typeof value.values !== "object" || Array.isArray(value.values) ||
      Object.keys(value.values).some(key => !aiSettingsFields.includes(key)) ||
      aiSettingsFields.some(key => typeof value.values[key] !== "string") ||
      (expectedInstanceId && value.instanceId !== expectedInstanceId)) throw new Error("Invalid AI settings");
  return value;
}

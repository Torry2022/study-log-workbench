import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertNoLinks } from "./instance.mjs";
import { atomicPrivateFile } from "./desktop/security.mjs";
import { aiSettingsFields as fields, aiSettingsIdPattern as identityPattern, parseAiSettings } from "../study-log-web/lib/ai-settings-schema.mjs";

// Only these values migrate from the deployment environment. Other service
// settings remain under the deployment owner's control.
const operationPattern = identityPattern;

export class AiSettingsError extends Error {
  constructor(code, message) { super(message); this.name = "AiSettingsError"; this.code = code; }
}
const fail = (code, message) => { throw new AiSettingsError(code, message); };
function target(root) {
  if (!root || !path.isAbsolute(root)) fail("AI_SETTINGS_UNAVAILABLE", "模型设置目录未准备好");
  return path.join(path.resolve(root), "ai-settings.json");
}
async function existingDirectory(root) {
  await assertNoLinks(root);
  const info = await fs.lstat(root).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!info?.isDirectory() || info.isSymbolicLink()) fail("AI_SETTINGS_UNAVAILABLE", "模型设置目录未准备好");
}
function parse(bytes, expectedInstanceId) {
  let value;
  try { value = parseAiSettings(bytes); } catch { fail("AI_SETTINGS_INVALID", "模型设置文件格式无效，请检查配置"); }
  if (expectedInstanceId && value.instanceId !== expectedInstanceId) fail("AI_SETTINGS_INSTANCE_CHANGED", "工作台身份已变化，请重新连接");
  return value;
}
export async function readAiSettings(root, expectedInstanceId) {
  const file = target(root);
  await existingDirectory(root); await assertNoLinks(file);
  const bytes = await fs.readFile(file, "utf8").catch(error => {
    if (error.code === "ENOENT") fail("AI_SETTINGS_NOT_INITIALIZED", "模型设置尚未导入");
    throw error;
  });
  return parse(bytes, expectedInstanceId);
}
async function withSettingsLock(root, operation) {
  await existingDirectory(root);
  // SQLite holds the lock in the kernel, so a dead writer cannot permanently
  // block future updates. The database stores no settings or credentials.
  const lock = path.join(root, ".ai-settings-lock.sqlite");
  await assertNoLinks(lock);
  const db = new DatabaseSync(lock);
  let begun = false;
  try {
    db.exec("PRAGMA busy_timeout=0");
    const deadline = Date.now() + 3000;
    while (!begun) {
      try { db.exec("BEGIN IMMEDIATE"); begun = true; }
      catch (error) {
        if (error?.code !== "ERR_SQLITE_ERROR" || !/locked|busy/i.test(error.message)) throw error;
        if (Date.now() >= deadline) fail("AI_SETTINGS_BUSY", "模型设置正在更新，请重试");
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    const result = await operation();
    db.exec("COMMIT"); begun = false;
    return result;
  } finally {
    if (begun) { try { db.exec("ROLLBACK"); } catch { /* Lock is released when the connection closes. */ } }
    db.close();
  }
}
function imported(env) { return Object.fromEntries(fields.map(key => [key, env[key] ?? ""])); }
export async function initializeAiSettings({ root, instanceId, env }) {
  if (!identityPattern.test(instanceId || "")) fail("AI_SETTINGS_INSTANCE_CHANGED", "工作台身份无效");
  return withSettingsLock(root, async () => {
    try { return await readAiSettings(root, instanceId); }
    catch (error) { if (!(error instanceof AiSettingsError) || error.code !== "AI_SETTINGS_NOT_INITIALIZED") throw error; }
    const value = { schemaVersion: 1, instanceId, revision: 1, operationId: null, values: imported(env) };
    await atomicPrivateFile(target(root), JSON.stringify(value) + "\n");
    return value;
  });
}
export function aiSettingsSummary(settings) {
  let endpointDisplay = "";
  try { endpointDisplay = new URL(settings.values.CHAT_API_URL).origin; } catch { /* Preserve invalid legacy config privately. */ }
  return { instanceId: settings.instanceId, revision: settings.revision, operationId: settings.operationId,
    provider: settings.values.CHAT_API_URL === "https://api.deepseek.com/chat/completions" ? "deepseek" : "custom",
    endpointDisplay, hasEndpoint: Boolean(settings.values.CHAT_API_URL), model: settings.values.CHAT_MODEL,
    hasKey: Boolean(settings.values.CHAT_API_KEY), lightModel: settings.values.CHAT_LIGHT_MODEL,
    contextWindowTokens: settings.values.RAG_CONTEXT_WINDOW_TOKENS,
    thinking: settings.values.RAG_DEEPSEEK_THINKING,
    toolCallingVerified: settings.values.RAG_AGENT_TOOL_CALLING_VERIFIED === "true",
    statusVerificationEnabled: settings.values.RAG_STATUS_VERIFICATION_ENABLED === "true" };
}
export async function saveAiSettings({ root, instanceId, expectedRevision, operationId, values, keyAction, remoteManaged, contextWindowConfirmed = false, beforeCommit }) {
  if (!identityPattern.test(instanceId || "") || !operationPattern.test(operationId || "") || !Number.isSafeInteger(expectedRevision))
    fail("AI_SETTINGS_INPUT", "模型设置请求无效");
  return withSettingsLock(root, async () => {
    if (beforeCommit) await beforeCommit();
    const current = await readAiSettings(root, instanceId);
    if (current.operationId === operationId) return aiSettingsSummary(current);
    if (current.revision !== expectedRevision) fail("AI_SETTINGS_CONFLICT", "模型设置已在另一处更新");
    if (!values || typeof values !== "object" || Array.isArray(values) ||
        Object.keys(values).some(key => !fields.includes(key)) || fields.some(key => typeof values[key] !== "string"))
      fail("AI_SETTINGS_INPUT", "模型设置字段无效");
    if (!["keep", "replace", "remove"].includes(keyAction)) fail("AI_SETTINGS_INPUT", "请选择密钥处理方式");
    const v = { ...values };
    const endpointChanged = v.CHAT_API_URL.trim() !== current.values.CHAT_API_URL.trim();
    if (endpointChanged && keyAction === "keep" && current.values.CHAT_API_KEY)
      fail("AI_SETTINGS_KEY_TARGET_CHANGED", "更换接口地址后请重新填写或移除密钥");
    if (keyAction === "keep") v.CHAT_API_KEY = current.values.CHAT_API_KEY;
    if (keyAction === "remove") v.CHAT_API_KEY = "";
    if (keyAction === "replace" && !v.CHAT_API_KEY.trim()) fail("AI_SETTINGS_INPUT", "请输入新密钥");
    if (v.CHAT_API_KEY && /[^\x21-\x7e]/.test(v.CHAT_API_KEY)) fail("AI_SETTINGS_INPUT", "密钥含无效字符");
    if ([v.CHAT_MODEL, v.CHAT_LIGHT_MODEL].some(value => /[\u0000-\u001f\u007f]/.test(value)))
      fail("AI_SETTINGS_INPUT", "模型名称含无效字符");
    if (v.CHAT_API_URL) {
      let url; try { url = new URL(v.CHAT_API_URL); } catch { fail("AI_SETTINGS_INPUT", "请输入完整接口地址"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || /[\s\\]/.test(v.CHAT_API_URL))
        fail("AI_SETTINGS_INPUT", "请输入完整接口地址");
    }
    if (v.RAG_CONTEXT_WINDOW_TOKENS && (!Number.isSafeInteger(Number(v.RAG_CONTEXT_WINDOW_TOKENS)) || Number(v.RAG_CONTEXT_WINDOW_TOKENS) <= 98304))
      fail("AI_SETTINGS_INPUT", "上下文容量必须是大于 98304 的整数");
    if (v.RAG_DEEPSEEK_THINKING && v.RAG_DEEPSEEK_THINKING !== current.values.RAG_DEEPSEEK_THINKING) {
      let endpoint; try { endpoint = new URL(v.CHAT_API_URL); } catch { fail("AI_SETTINGS_INPUT", "推理选项与接口不匹配"); }
      if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.deepseek.com" ||
          !["deepseek-flash", "deepseek-v4-pro"].includes(v.CHAT_MODEL) || !["disabled", "low"].includes(v.RAG_DEEPSEEK_THINKING))
        fail("AI_SETTINGS_INPUT", "推理选项与接口或模型不匹配");
    }
    const modelChanged = v.CHAT_MODEL.trim() !== current.values.CHAT_MODEL.trim();
    if (endpointChanged || modelChanged || keyAction !== "keep") {
      v.RAG_AGENT_TOOL_CALLING_VERIFIED = "false";
      v.RAG_STATUS_VERIFICATION_ENABLED = "false";
      if ((endpointChanged || modelChanged) && !contextWindowConfirmed) v.RAG_CONTEXT_WINDOW_TOKENS = "";
    } else {
      // Verification results are maintained only by their trusted checks.
      v.RAG_AGENT_TOOL_CALLING_VERIFIED = current.values.RAG_AGENT_TOOL_CALLING_VERIFIED;
      v.RAG_STATUS_VERIFICATION_ENABLED = current.values.RAG_STATUS_VERIFICATION_ENABLED;
    }
    const managed = remoteManaged === undefined ? Boolean(current.remoteManaged && !(endpointChanged && keyAction !== "keep")) : remoteManaged;
    const next = { schemaVersion: 1, instanceId, revision: current.revision + 1, operationId, remoteManaged: managed, values: v };
    if (beforeCommit) await beforeCommit();
    await atomicPrivateFile(target(root), JSON.stringify(next) + "\n");
    return aiSettingsSummary(next);
  });
}

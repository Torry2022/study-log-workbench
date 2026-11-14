import { NextRequest } from "next/server";
import { authorizeSettingsMutation, readSettingsOperation, SettingsOperationError } from "./ai-settings-operation.ts";
import { remoteEndpointAllowed, remoteSafeFetch } from "./ai-outbound.ts";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogRoot } from "./config.ts";
import { readAiSettingsRecord } from "./ai-settings-reader.ts";

/** Probe only the explicitly submitted draft or the current private key for the same target. */
export async function probeSettings(request: NextRequest, kind: "models" | "test") {
  authorizeSettingsMutation(request);
  const { body, root, current, instanceId } = await readSettingsOperation(request);
  if (body.expectedRevision !== current.revision) throw new SettingsOperationError("AI_SETTINGS_CONFLICT", "模型设置已在另一处更新", 409);
  if (!["keep", "replace"].includes(String(body.endpointAction)) || !["keep", "replace"].includes(String(body.keyAction))) throw new SettingsOperationError("AI_SETTINGS_INPUT", "检查请求格式无效", 400);
  const endpoint = body.endpointAction === "keep" ? current.values.CHAT_API_URL : typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!remoteEndpointAllowed(endpoint)) throw new SettingsOperationError("AI_SETTINGS_ENDPOINT_NOT_ALLOWED", "该服务地址未获得部署者允许", 403);
  if (body.keyAction === "keep" && endpoint !== current.values.CHAT_API_URL) throw new SettingsOperationError("AI_SETTINGS_KEY_TARGET_CHANGED", "更换接口地址后请重新填写密钥", 400);
  const key = body.keyAction === "keep" ? current.values.CHAT_API_KEY : typeof body.key === "string" ? body.key : "";
  if (!key || /[^\x21-\x7e]/.test(key)) throw new SettingsOperationError("AI_SETTINGS_INPUT", "请填写有效的 API Key", 400);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (kind === "test" && (!model || /[\u0000-\u001f\u007f]/.test(model))) throw new SettingsOperationError("AI_SETTINGS_INPUT", "请填写有效的模型名称", 400);
  if (kind === "models" && endpoint !== "https://api.deepseek.com/chat/completions") throw new SettingsOperationError("AI_SETTINGS_MODELS_UNSUPPORTED", "此服务请手动填写模型名称", 400);
  const target = kind === "models" ? "https://api.deepseek.com/models" : endpoint;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)]);
  let response: Response;
  try { response = await remoteSafeFetch(target, { method: kind === "models" ? "GET" : "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal,
    ...(kind === "test" ? { body: JSON.stringify({ model, messages: [{ role: "user", content: "请回复 OK。" }], max_tokens: 8, stream: false }) } : {}) }); }
  catch { throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "无法连接模型服务，请检查配置后重试", 502); }
  if (!response.ok) { await response.body?.cancel(); throw new SettingsOperationError(response.status === 429 ? "AI_SETTINGS_RATE_LIMITED" : "AI_SETTINGS_CHECK_FAILED", response.status === 429 ? "模型服务请求过于频繁，请稍后重试" : "模型服务未通过检查，请核对配置", response.status === 429 ? 429 : 502); }
  const reader = response.body?.getReader(); if (!reader) throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "模型服务返回了无效响应", 502);
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 262144) throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "模型服务返回内容过长", 502); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let payload: unknown; try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "模型服务返回了无效响应", 502); }
  authorizeSettingsMutation(request);
  try {
    const identity = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8"));
    if (identity.schemaVersion !== 1 || identity.id !== instanceId) throw new SettingsOperationError("AI_SETTINGS_INSTANCE_CHANGED", "工作台身份已变化，请重新连接", 409);
    if (readAiSettingsRecord(root, instanceId).revision !== current.revision) throw new SettingsOperationError("AI_SETTINGS_CONFLICT", "模型设置已在另一处更新，请重新检查", 409);
  } catch (error) { if (error instanceof SettingsOperationError) throw error; throw new SettingsOperationError("AI_CONFIGURATION_INVALID", "模型设置无法读取，请检查工作台配置", 503); }
  if (kind === "models") {
    const entries = (payload as { data?: unknown })?.data;
    if (!Array.isArray(entries)) throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "模型服务返回了无效模型列表", 502);
    const models = entries.slice(0, 200).map(item => item?.id).filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/.test(id));
    return { instanceId, revision: current.revision, models };
  }
  const answer = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) throw new SettingsOperationError("AI_SETTINGS_CHECK_FAILED", "模型没有返回有效内容", 502);
  return { instanceId, revision: current.revision, ok: true };
}

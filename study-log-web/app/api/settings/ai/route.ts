import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { summarizeAiSettings } from "@/lib/ai-settings-reader";
import { authorizeSettingsMutation, readSettingsOperation, settingsFailure, SettingsOperationError, verifySettingsIdentity } from "@/lib/ai-settings-operation";
import { remoteEndpointAllowed } from "@/lib/ai-outbound";
import { deploymentSnapshot } from "@/lib/ai-deployment-snapshot";
import { saveAiSettings, aiSettingsSummary, AiSettingsError } from "../../../../../ops/ai-settings.mjs";

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

export async function PUT(request: NextRequest) {
  try {
    authorizeSettingsMutation(request);
    const { body, root, instanceId, current } = await readSettingsOperation(request);
    const beforeCommit = async () => { authorizeSettingsMutation(request); await verifySettingsIdentity(instanceId); };
    const operationId = body.operationId, expectedRevision = body.expectedRevision;
    if (typeof operationId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(operationId) || !Number.isSafeInteger(expectedRevision)) throw new SettingsOperationError("AI_SETTINGS_INPUT", "设置请求格式无效", 400);
    if (current.operationId === operationId) { await beforeCommit(); return Response.json({ ...aiSettingsSummary(current), source: "instance" }, { headers }); }
    if (body.mode === "restore_deployment") {
      const snapshot = deploymentSnapshot(instanceId);
      if (body.previewId !== snapshot.previewId) throw new SettingsOperationError("AI_SETTINGS_PREVIEW_CHANGED", "部署配置已变化，请重新核对", 409);
      if (snapshot.values.CHAT_API_URL && !remoteEndpointAllowed(snapshot.values.CHAT_API_URL)) throw new SettingsOperationError("AI_SETTINGS_ENDPOINT_NOT_ALLOWED", "部署配置的服务地址未获得远程修改许可", 403);
      try {
        const result = await saveAiSettings({ root, instanceId, expectedRevision: expectedRevision as number, operationId, values: snapshot.values, keyAction: snapshot.values.CHAT_API_KEY ? "replace" : "remove", remoteManaged: true, beforeCommit });
        return Response.json({ ...result, source: "instance" }, { headers });
      } catch (error) {
        if (error instanceof AiSettingsError) throw new SettingsOperationError(error.code, error.message, error.code === "AI_SETTINGS_CONFLICT" ? 409 : error.code === "AI_SETTINGS_BUSY" ? 503 : 400);
        throw error;
      }
    }
    if (!["keep", "replace"].includes(String(body.endpointAction)) || !["keep", "replace", "remove"].includes(String(body.keyAction)) || !["deepseek", "custom"].includes(String(body.provider)) || typeof body.model !== "string" || typeof body.lightModel !== "string") throw new SettingsOperationError("AI_SETTINGS_INPUT", "设置请求格式无效", 400);
    const endpoint = body.endpointAction === "keep" ? current.values.CHAT_API_URL : typeof body.endpoint === "string" ? body.endpoint.trim() : "";
    if (endpoint && !remoteEndpointAllowed(endpoint)) throw new SettingsOperationError("AI_SETTINGS_ENDPOINT_NOT_ALLOWED", "该服务地址未获得部署者允许", 403);
    if (!endpoint && body.keyAction === "replace") throw new SettingsOperationError("AI_SETTINGS_INPUT", "请先填写服务地址再保存密钥", 400);
    if (body.provider === "deepseek" && endpoint !== "https://api.deepseek.com/chat/completions" || body.provider === "custom" && endpoint === "https://api.deepseek.com/chat/completions") throw new SettingsOperationError("AI_SETTINGS_INPUT", "服务商与地址不匹配", 400);
    if (body.keyAction === "replace" && typeof body.key !== "string" || body.keyAction !== "replace" && body.key !== undefined) throw new SettingsOperationError("AI_SETTINGS_INPUT", "密钥操作无效", 400);
    if (body.contextWindowTokens !== undefined && typeof body.contextWindowTokens !== "string" || body.thinking !== undefined && typeof body.thinking !== "string") throw new SettingsOperationError("AI_SETTINGS_INPUT", "高级设置格式无效", 400);
    const values = { ...current.values, CHAT_API_URL: endpoint, CHAT_MODEL: body.model, CHAT_LIGHT_MODEL: body.lightModel,
      RAG_CONTEXT_WINDOW_TOKENS: typeof body.contextWindowTokens === "string" ? body.contextWindowTokens : current.values.RAG_CONTEXT_WINDOW_TOKENS,
      RAG_DEEPSEEK_THINKING: typeof body.thinking === "string" ? body.thinking : current.values.RAG_DEEPSEEK_THINKING,
      CHAT_API_KEY: typeof body.key === "string" ? body.key : "" };
    try {
      const result = await saveAiSettings({ root, instanceId, expectedRevision: expectedRevision as number, operationId, values, keyAction: body.keyAction as string, remoteManaged: true, contextWindowConfirmed: typeof body.contextWindowTokens === "string", beforeCommit });
      return Response.json({ ...result, source: "instance" }, { headers });
    } catch (error) {
      if (error instanceof AiSettingsError) throw new SettingsOperationError(error.code, error.message, error.code === "AI_SETTINGS_CONFLICT" || error.code === "AI_SETTINGS_INSTANCE_CHANGED" ? 409 : error.code === "AI_SETTINGS_BUSY" ? 503 : 400);
      throw error;
    }
  } catch (error) { return settingsFailure(error); }
}

import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { isAppTokenAuthenticated, isCookieAuthenticated, verifyPassword } from "./auth.ts";
import { getLogRoot } from "./config.ts";
import { readAiSettingsRecord } from "./ai-settings-reader.ts";
import { remoteEndpointAllowed } from "./ai-outbound.ts";

export class SettingsOperationError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message); }
}
const fail = (code: string, message: string, status: number): never => { throw new SettingsOperationError(code, message, status); };
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
let failures: number[] = [];

export async function verifySettingsIdentity(instanceId: string) {
  let identity: { schemaVersion?: number; id?: string };
  try { identity = JSON.parse(await fs.readFile(path.join(getLogRoot(), ".instance.json"), "utf8")); }
  catch { return fail("AI_SETTINGS_UNAVAILABLE", "工作台身份无法读取", 503); }
  if (identity.schemaVersion !== 1 || identity.id !== instanceId) fail("AI_SETTINGS_INSTANCE_CHANGED", "工作台身份已变化，请重新连接", 409);
}

/** Authentication and origin are checked before reading a password or private configuration. */
export function authorizeSettingsMutation(request: NextRequest, env: NodeJS.ProcessEnv = process.env) {
  if (request.headers.has("authorization")) {
    if (!isAppTokenAuthenticated(request)) fail("UNAUTHORIZED", "请重新登录", 401);
  } else {
    if (!isCookieAuthenticated(request)) fail("UNAUTHORIZED", "请重新登录", 401);
    const expected = env.AI_SETTINGS_PUBLIC_ORIGIN;
    let origin = "";
    try { const parsed = new URL(expected || ""); if (parsed.origin === expected && ["https:", "http:"].includes(parsed.protocol)) origin = parsed.origin; } catch { /* Explicit deployment origin is mandatory. */ }
    if (!origin || request.headers.get("origin") !== origin) fail("AI_SETTINGS_ORIGIN", "当前请求来源未获允许", 403);
  }
  if (env.AI_SETTINGS_REMOTE_WRITE_ENABLED !== "true") fail("AI_SETTINGS_READ_ONLY", "模型设置由工作台维护者管理", 403);
  try { const targets = JSON.parse(env.AI_SETTINGS_ALLOWED_ENDPOINTS || "[]"); if (!Array.isArray(targets) || !targets.some(value => typeof value === "string" && remoteEndpointAllowed(value, env))) throw Error(); }
  catch { fail("AI_SETTINGS_READ_ONLY", "模型设置由工作台维护者管理", 403); }
  if (!env.AI_SETTINGS_ROOT || !path.isAbsolute(env.AI_SETTINGS_ROOT)) fail("AI_SETTINGS_UNAVAILABLE", "模型设置目录未准备好", 503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail("AI_SETTINGS_INPUT", "设置请求格式无效", 400);
}

export async function readSettingsOperation(request: NextRequest) {
  const max = 32768;
  if (Number(request.headers.get("content-length") || 0) > max) fail("AI_SETTINGS_INPUT", "设置请求过大", 413);
  const reader = request.body?.getReader(); if (!reader) fail("AI_SETTINGS_INPUT", "设置请求格式无效", 400);
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader!.read(); if (done) break; total += value.length; if (total > max) fail("AI_SETTINGS_INPUT", "设置请求过大", 413); chunks.push(value); } }
  finally { await reader!.cancel().catch(() => {}); reader!.releaseLock(); }
  let body: Record<string, unknown>;
  try { const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error(); body = parsed; }
  catch { return fail("AI_SETTINGS_INPUT", "设置请求格式无效", 400); }
  const now = Date.now(); failures = failures.filter(value => now - value < 60000);
  if (failures.length >= 5) fail("AI_SETTINGS_REAUTH_LIMIT", "确认次数过多，请稍后重试", 429);
  if (!verifyPassword(body.password)) { failures.push(now); fail("AI_SETTINGS_REAUTH_FAILED", "工作台密码不正确", 403); }
  failures = [];
  const instanceId = typeof body.expectedInstanceId === "string" ? body.expectedInstanceId : "";
  if (!idPattern.test(instanceId)) fail("AI_SETTINGS_INPUT", "工作台身份无效", 400);
  await verifySettingsIdentity(instanceId);
  const root = process.env.AI_SETTINGS_ROOT!;
  let current: ReturnType<typeof readAiSettingsRecord>;
  try { current = readAiSettingsRecord(root, instanceId); }
  catch { return fail("AI_CONFIGURATION_INVALID", "模型设置无法读取，请检查工作台配置", 503); }
  return { body, root, instanceId, current };
}

export function settingsFailure(error: unknown) {
  if (error instanceof SettingsOperationError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  return Response.json({ code: "AI_SETTINGS_FAILED", error: "设置操作未完成，请重试" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

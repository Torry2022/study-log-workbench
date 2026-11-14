import { readFileSync } from "node:fs";
import path from "node:path";
import { readAiSettingsRecord } from "./ai-settings-reader.ts";
import { remoteEndpointAllowed } from "./ai-outbound.ts";

export interface ChatConfig {
  /** Request-scoped observer; never persisted in settings. */
  onUsage?: (usage: { inputTokens: number | null; outputTokens: number | null }) => void;
  /** Verified request-scoped model capability; never inferred from a proxy's model name. */
  contextWindowTokens?: number;
  /** Optional provider-specific RAG setting; absent for generic compatible models. */
  thinkingMode?: "disabled" | "low";
  apiKey: string;
  model: string;
  /** Complete OpenAI-compatible chat/completions endpoint; never expanded. */
  baseUrl: string;
  /** Frozen deployer policy for a remotely editable target; absent for deployment-managed targets. */
  outboundPolicy?: Record<string, string | undefined>;
}

export function chatContextWindowTokens(config: ChatConfig): number | undefined {
  if (Number.isSafeInteger(config.contextWindowTokens) && config.contextWindowTokens! > 98304) return config.contextWindowTokens;
  return undefined;
}

type AiEnvironment = Record<string, string | undefined>;
/** Read one complete, committed model configuration for a new operation. */
export function snapshotAiEnvironment(env: AiEnvironment = process.env): AiEnvironment {
  const root = env.AI_SETTINGS_ROOT;
  if (!root) return { ...env, __STUDY_LOG_DEPLOYMENT_ENDPOINT: env.CHAT_API_URL || "" };
  try {
    const logRoot = env.LOG_ROOT;
    if (!logRoot || !path.isAbsolute(logRoot)) throw new Error("Invalid root");
    const identity = JSON.parse(readFileSync(path.join(logRoot, ".instance.json"), "utf8"));
    if (identity.schemaVersion !== 1 || typeof identity.id !== "string") throw new Error("Invalid identity");
    const record = readAiSettingsRecord(root, identity.id);
    return { ...env, ...record.values, __STUDY_LOG_PERSISTED_THINKING: "true", __STUDY_LOG_REMOTE_MANAGED: record.remoteManaged ? "true" : "false", __STUDY_LOG_DEPLOYMENT_ENDPOINT: env.CHAT_API_URL || "" };
  } catch {
    throw new ChatConfigurationError([{ field: "AI_SETTINGS", reason: "invalid", message: "模型设置无法读取，请检查工作台配置" }]);
  }
}
export interface ChatConfigIssue {
  field: "AI_SETTINGS" | "CHAT_API_KEY" | "CHAT_API_URL" | "CHAT_MODEL" | "CHAT_LIGHT_MODEL" | "RAG_CONTEXT_WINDOW_TOKENS" | "RAG_DEEPSEEK_THINKING";
  reason: "missing" | "invalid";
  message: string;
}

export class ChatConfigurationError extends Error {
  readonly code = "AI_CONFIGURATION_INVALID";
  readonly issues: ChatConfigIssue[];
  constructor(issues: ChatConfigIssue[]) {
    super(issues.map(issue => issue.message).join("；"));
    this.issues = issues;
    this.name = "ChatConfigurationError";
  }
}

function issuesFor(env: AiEnvironment): ChatConfigIssue[] {
  const issues: ChatConfigIssue[] = [];
  for (const field of ["CHAT_API_KEY", "CHAT_API_URL", "CHAT_MODEL"] as const) {
    if (!env[field]?.trim()) issues.push({ field, reason: "missing", message: `请配置 ${field}` });
  }
  // Bearer credentials must be usable as a header, without exposing their value.
  if (env.CHAT_API_KEY?.trim() && /[^\x21-\x7e]/.test(env.CHAT_API_KEY.trim())) {
    issues.push({ field: "CHAT_API_KEY", reason: "invalid", message: "CHAT_API_KEY 含无效的请求头字符" });
  }
  for (const field of ["CHAT_MODEL", "CHAT_LIGHT_MODEL"] as const) {
    if (env[field] && /[\u0000-\u001f\u007f]/.test(env[field])) {
      issues.push({ field, reason: "invalid", message: `${field} 含控制字符` });
    }
  }
  if (env.RAG_CONTEXT_WINDOW_TOKENS?.trim()) {
    const value = Number(env.RAG_CONTEXT_WINDOW_TOKENS.trim());
    if (!Number.isSafeInteger(value) || value <= 98304) {
      issues.push({ field: "RAG_CONTEXT_WINDOW_TOKENS", reason: "invalid", message: "RAG_CONTEXT_WINDOW_TOKENS 必须是大于 98304 的整数" });
    }
  }
  const endpoint = env.CHAT_API_URL?.trim();
  if (endpoint) {
    let valid = /^https?:\/\//i.test(endpoint) && !/[\\\u0000-\u0020\u007f]/.test(endpoint);
    try {
      const url = new URL(endpoint);
      valid &&= ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) &&
        !url.username && !url.password && !endpoint.includes("#");
    } catch { valid = false; }
    if (!valid) issues.push({ field: "CHAT_API_URL", reason: "invalid", message: "CHAT_API_URL 必须是无用户凭据和片段的完整 HTTP(S) 接口地址" });
  }
  return issues;
}

/** Local validation only. HTTP is an explicit administrator choice, including non-loopback proxies. */
export function inspectChatConfig(env: AiEnvironment = snapshotAiEnvironment()): { configured: boolean; issues: ChatConfigIssue[] } {
  const issues = issuesFor(env);
  return { configured: issues.length === 0, issues };
}

export function getChatConfig(env: AiEnvironment = snapshotAiEnvironment()): ChatConfig {
  const { issues } = inspectChatConfig(env);
  if (issues.length) throw new ChatConfigurationError(issues);
  const contextWindowTokens = env.RAG_CONTEXT_WINDOW_TOKENS?.trim();
  const baseUrl = env.CHAT_API_URL!.trim();
  // A target introduced through remote settings remains constrained even if it
  // is later removed from the allowlist. Existing deployment targets retain
  // their established behavior until explicitly added to that list.
  const outboundPolicy = env.__STUDY_LOG_REMOTE_MANAGED === "true" || env.AI_SETTINGS_REMOTE_WRITE_ENABLED === "true" && (baseUrl !== (env.__STUDY_LOG_DEPLOYMENT_ENDPOINT || "") || remoteEndpointAllowed(baseUrl, env)) ? { AI_SETTINGS_ALLOWED_ENDPOINTS: env.AI_SETTINGS_ALLOWED_ENDPOINTS } : undefined;
  return { apiKey: env.CHAT_API_KEY!.trim(), model: env.CHAT_MODEL!.trim(), baseUrl, ...(outboundPolicy ? { outboundPolicy } : {}),
    ...(contextWindowTokens ? { contextWindowTokens: Number(contextWindowTokens) } : {}) };
}

export function getLightChatConfig(env: AiEnvironment = snapshotAiEnvironment()): ChatConfig {
  const config = getChatConfig(env);
  return { ...config, model: env.CHAT_LIGHT_MODEL?.trim() || config.model };
}

/** Unset keeps provider defaults. Never infer proxy capabilities from a model name. */
export function configureRagThinking(config: ChatConfig, env: AiEnvironment = process.env): ChatConfig {
  const mode = env.RAG_DEEPSEEK_THINKING?.trim();
  if (!mode) return config;
  const endpoint = new URL(config.baseUrl);
  if (env.__STUDY_LOG_PERSISTED_THINKING === "true" && ["disabled", "low"].includes(mode) && (endpoint.protocol !== "https:" || endpoint.hostname !== "api.deepseek.com" || !["deepseek-flash", "deepseek-v4-pro"].includes(config.model))) return config;
  if (!["disabled", "low"].includes(mode) || endpoint.protocol !== "https:" || endpoint.hostname !== "api.deepseek.com" ||
    !["deepseek-flash", "deepseek-v4-pro"].includes(config.model)) {
    throw new ChatConfigurationError([{ field: "RAG_DEEPSEEK_THINKING", reason: "invalid", message: "RAG_DEEPSEEK_THINKING 仅支持官方 DeepSeek Flash/Pro 的 disabled 或 low" }]);
  }
  return { ...config, thinkingMode: mode as "disabled" | "low" };
}

export function inspectRagChatConfig(env: AiEnvironment = snapshotAiEnvironment()): { configured: boolean; issues: ChatConfigIssue[] } {
  const provider = inspectChatConfig(env);
  if (!provider.configured) return provider;
  try {
    configureRagThinking(getChatConfig(env), env);
    return provider;
  } catch (error) {
    if (error instanceof ChatConfigurationError) return { configured: false, issues: error.issues };
    throw error;
  }
}

export function chatThinkingParameters(config: ChatConfig): { thinking?: { type: "enabled" | "disabled" }; reasoning_effort?: "low" } {
  if (!config.thinkingMode) return {};
  // Recheck request-scoped callers as well as environment configuration.
  configureRagThinking(config, { RAG_DEEPSEEK_THINKING: config.thinkingMode });
  return config.thinkingMode === "disabled" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: "low" };
}

export interface ChatConfig {
  apiKey: string;
  model: string;
  /** Complete OpenAI-compatible chat/completions endpoint; never expanded. */
  baseUrl: string;
}

type AiEnvironment = Record<string, string | undefined>;
export interface ChatConfigIssue {
  field: "CHAT_API_KEY" | "CHAT_API_URL" | "CHAT_MODEL" | "CHAT_LIGHT_MODEL";
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
export function inspectChatConfig(env: AiEnvironment = process.env): { configured: boolean; issues: ChatConfigIssue[] } {
  const issues = issuesFor(env);
  return { configured: issues.length === 0, issues };
}

export function getChatConfig(env: AiEnvironment = process.env): ChatConfig {
  const { issues } = inspectChatConfig(env);
  if (issues.length) throw new ChatConfigurationError(issues);
  return { apiKey: env.CHAT_API_KEY!.trim(), model: env.CHAT_MODEL!.trim(), baseUrl: env.CHAT_API_URL!.trim() };
}

export function getLightChatConfig(env: AiEnvironment = process.env): ChatConfig {
  const config = getChatConfig(env);
  return { ...config, model: env.CHAT_LIGHT_MODEL?.trim() || config.model };
}

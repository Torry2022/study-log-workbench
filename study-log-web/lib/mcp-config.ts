type McpEnvironment = Record<string, string | undefined>;
export interface McpConfig { url: string; token: string }
export interface McpConfigIssue { field: "STUDY_LOG_MCP_URL" | "STUDY_LOG_MCP_TOKEN"; reason: "missing" | "invalid"; message: string }
export class McpConfigurationError extends Error {
  readonly code = "MCP_CONFIGURATION_INVALID";
  readonly issues: McpConfigIssue[];
  constructor(issues: McpConfigIssue[]) { super(issues.map(issue => issue.message).join("；")); this.name = "McpConfigurationError"; this.issues = issues; }
}

/** Configuration readiness is local validation, not a connectivity check. HTTP is an explicit administrator choice. */
export function inspectMcpConfig(env: McpEnvironment = process.env): { configured: boolean; issues: McpConfigIssue[] } {
  const issues: McpConfigIssue[] = [];
  for (const field of ["STUDY_LOG_MCP_URL", "STUDY_LOG_MCP_TOKEN"] as const) {
    if (!env[field]?.trim()) issues.push({ field, reason: "missing", message: `请配置 ${field}` });
  }
  const endpoint = env.STUDY_LOG_MCP_URL?.trim();
  if (endpoint) {
    let valid = /^https?:\/\//i.test(endpoint) && !/[\\\u0000-\u0020\u007f]/.test(endpoint);
    try { const url = new URL(endpoint); valid &&= Boolean(url.hostname) && !url.username && !url.password && !endpoint.includes("#"); }
    catch { valid = false; }
    if (!valid) issues.push({ field: "STUDY_LOG_MCP_URL", reason: "invalid", message: "STUDY_LOG_MCP_URL 必须是无用户凭据和片段的完整 HTTP(S) 接口地址" });
  }
  if (env.STUDY_LOG_MCP_TOKEN?.trim() && /[^\x21-\x7e]/.test(env.STUDY_LOG_MCP_TOKEN.trim())) {
    issues.push({ field: "STUDY_LOG_MCP_TOKEN", reason: "invalid", message: "STUDY_LOG_MCP_TOKEN 含无效的请求头字符" });
  }
  return { configured: issues.length === 0, issues };
}

export function getMcpConfig(env: McpEnvironment = process.env): McpConfig {
  const { issues } = inspectMcpConfig(env);
  if (issues.length) throw new McpConfigurationError(issues);
  return { url: env.STUDY_LOG_MCP_URL!.trim(), token: env.STUDY_LOG_MCP_TOKEN!.trim() };
}

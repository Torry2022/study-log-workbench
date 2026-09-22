import type { ChatConfig } from "./ai-config.ts";

export class AiChatError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) { super(message); this.code = code; this.status = status; this.name = "AiChatError"; }
}
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export const CHAT_TIMEOUT_MS = 90_000;
export const MAX_CHAT_RESPONSE_BYTES = 1024 * 1024;

/** Shared non-streaming transport. Never expose provider URLs, bodies or credentials in errors. */
export async function requestChat(config: ChatConfig, messages: ChatMessage[], options: { signal?: AbortSignal; temperature?: number; timeoutMs?: number } = {}): Promise<string> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? CHAT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  try {
    signal.throwIfAborted();
    const response = await fetch(config.baseUrl, {
      method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: options.temperature ?? 0.3, stream: false })
    });
    signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new AiChatError("AI_RATE_LIMITED", "模型服务请求过于频繁，请稍后重试", 429);
      if (response.status === 401 || response.status === 403) throw new AiChatError("AI_PROVIDER_AUTH", "模型服务认证失败，请检查实例的聊天配置");
      throw new AiChatError("AI_PROVIDER_FAILED", "模型服务暂时不可用，请稍后重试");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AiChatError("AI_INVALID_RESPONSE", "模型服务返回了无效响应，请重试");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CHAT_RESPONSE_BYTES) throw new AiChatError("AI_RESPONSE_TOO_LARGE", "模型响应过长，请缩小材料范围后重试");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new AiChatError("AI_INVALID_RESPONSE", "模型服务返回了无效 JSON，请重试"); }
    const choice = (payload as { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> } | null)?.choices?.[0];
    if (choice?.finish_reason === "length") throw new AiChatError("AI_OUTPUT_TRUNCATED", "模型输出被截断，请缩小材料范围后重试");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AiChatError("AI_EMPTY_RESPONSE", "模型没有返回有效正文，请重试");
    signal.throwIfAborted();
    return content;
  } catch (error) {
    if (options.signal?.aborted) throw new AiChatError("AI_CANCELLED", "已取消生成", 499);
    if (deadline.signal.aborted) throw new AiChatError("AI_TIMEOUT", "模型响应超时，请重试", 504);
    if (error instanceof AiChatError) throw error;
    throw new AiChatError("AI_NETWORK_ERROR", "无法连接模型服务，请检查实例配置或稍后重试");
  } finally { clearTimeout(timer); }
}

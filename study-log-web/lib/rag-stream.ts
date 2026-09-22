import { AiChatError } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { RagPromptMessage } from "./rag-types.ts";

export const MAX_RAG_STREAM_BYTES = 1024 * 1024;
export const MAX_RAG_ANSWER_CHARS = 120000;

/** OpenAI-compatible streaming response. Only an explicit completion marker completes an answer. */
export async function streamRagAnswer(config: ChatConfig, messages: RagPromptMessage[], onDelta: (text: string) => void, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), options.timeoutMs ?? 90000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const invalid = () => new AiChatError("AI_INVALID_STREAM", "模型返回了无效的流式响应，请重试");
  try {
    signal.throwIfAborted();
    const response = await fetch(config.baseUrl, { method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages, temperature: 0.2, stream: true }) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new AiChatError("AI_RATE_LIMITED", "模型服务请求过于频繁，请稍后重试", 429);
      if ([401, 403].includes(response.status)) throw new AiChatError("AI_PROVIDER_AUTH", "模型服务认证失败，请检查实例的聊天配置");
      throw new AiChatError("AI_PROVIDER_FAILED", "模型服务暂时不可用，请稍后重试");
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") || !response.body) { await response.body?.cancel(); throw invalid(); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "", data: string[] = [], answer = "", bytes = 0, completed = false;
    const dispatch = () => {
      if (!data.length || completed) { data = []; return; }
      const value = data.join("\n").trim(); data = [];
      if (value === "[DONE]") { completed = true; return; }
      if (!value) return;
      let payload;
      try { payload = JSON.parse(value); } catch { throw invalid(); }
      if (!payload || typeof payload !== "object" || payload.error || !Array.isArray(payload.choices)) throw invalid();
      // A provider may send an empty choices array for its final usage event.
      if (!payload.choices.length) return;
      const choice = payload.choices[0];
      if (!choice || typeof choice !== "object") throw invalid();
      if (choice.finish_reason === "length") throw new AiChatError("AI_OUTPUT_TRUNCATED", "模型输出被截断，请缩小问题范围后重试");
      if (choice.finish_reason && choice.finish_reason !== "stop") throw new AiChatError("AI_OUTPUT_INCOMPLETE", "模型未能完整回答，请调整问题后重试");
      const delta = choice.delta?.content;
      if (delta !== undefined && delta !== null && typeof delta !== "string") throw invalid();
      if (!delta) return;
      if (answer.length + delta.length > MAX_RAG_ANSWER_CHARS) throw new AiChatError("AI_RESPONSE_TOO_LARGE", "回答过长，请缩小问题范围后重试");
      answer += delta; onDelta(delta);
    };
    const line = (value: string) => {
      if (value === "") { dispatch(); return; }
      if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
    };
    try {
      while (!completed) {
        const { done, value } = await reader.read(); signal.throwIfAborted();
        bytes += value?.byteLength || 0;
        if (bytes > MAX_RAG_STREAM_BYTES) throw new AiChatError("AI_RESPONSE_TOO_LARGE", "模型响应过长，请缩小问题范围后重试");
        buffer += decoder.decode(value, { stream: !done });
        let match: RegExpExecArray | null;
        while ((match = /\r\n|\r|\n/.exec(buffer))) {
          if (!done && match[0] === "\r" && match.index === buffer.length - 1) break;
          line(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
          if (completed) break;
        }
        if (done) { if (buffer) line(buffer); dispatch(); break; }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal.throwIfAborted();
    if (!completed) throw new AiChatError("AI_STREAM_INTERRUPTED", "模型响应提前中断，当前内容尚未完成，请重试");
    if (!answer.trim()) throw new AiChatError("AI_EMPTY_RESPONSE", "模型没有返回有效正文，请重试");
    return answer.trim();
  } catch (error) {
    if (options.signal?.aborted) throw new AiChatError("AI_CANCELLED", "已取消回答", 499);
    if (deadline.signal.aborted) throw new AiChatError("AI_TIMEOUT", "模型响应超时，请重试", 504);
    if (error instanceof AiChatError) throw error;
    throw new AiChatError("AI_NETWORK_ERROR", "模型响应中断，请检查实例配置或稍后重试");
  } finally { clearTimeout(timer); }
}

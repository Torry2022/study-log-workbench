import { withBasePath } from "./base-path.ts";
import { ApiRequestError, AUTH_EXPIRED_EVENT, workspaceRequestSignal } from "./client-http.ts";
import type { RagCitation } from "./rag-types.ts";

export function clientUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type RagEvent = { kind: "status"; message: string } | { kind: "sources"; citations: RagCitation[] } |
  { kind: "delta"; text: string } | { kind: "done"; answer: string; citations: RagCitation[]; groundingWarning?: string };
function sources(value: unknown): RagCitation[] {
  if (!Array.isArray(value) || value.length > 30 || value.some(item => !item || typeof item !== "object" ||
    !/^S[1-9]\d*$/.test(item.sourceId) || typeof item.date !== "string" || typeof item.month !== "string" ||
    typeof item.fileName !== "string" || (item.heading !== null && typeof item.heading !== "string") ||
    (item.headingIndex !== null && (!Number.isInteger(item.headingIndex) || item.headingIndex < 0)) ||
    typeof item.contentHash !== "string" || typeof item.chunkId !== "string")) throw new Error("问答来源响应不完整，请重试");
  return value;
}
/** Only a validated done frame proves completion. A truncated stream remains an error. */
export async function consumeRagStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, emit: (event: RagEvent) => void) {
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", completed = false, bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  function frame(raw: string) {
    const lines = raw.split(/\r?\n/), name = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const value = JSON.parse(data);
    if (!value || typeof value !== "object") throw new Error("问答响应格式错误");
    if (name === "error") throw new Error(typeof value.message === "string" ? value.message : "问答失败，请重试");
    if (name === "status" && typeof value.message === "string") emit({ kind: "status", message: value.message });
    else if (name === "sources") emit({ kind: "sources", citations: sources(value.citations) });
    else if (name === "delta" && typeof value.text === "string") emit({ kind: "delta", text: value.text });
    else if (name === "done" && typeof value.answer === "string" && value.answer.trim() &&
      (value.groundingWarning === undefined || typeof value.groundingWarning === "string")) {
      emit({ kind: "done", answer: value.answer, citations: sources(value.citations), groundingWarning: value.groundingWarning }); completed = true;
    } else throw new Error("问答响应格式错误");
  }
  try {
    signal.throwIfAborted();
    while (!completed) {
      const next = await reader.read(); signal.throwIfAborted();
      if (next.done) { buffer += decoder.decode(); break; }
      bytes += next.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new Error("问答响应超过限制");
      buffer += decoder.decode(next.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while (!completed && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        const raw = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length); frame(raw);
      }
      if (buffer.length > 512 * 1024) throw new Error("问答单条响应超过限制");
    }
    if (!completed) throw new Error("回答连接提前结束，已保留收到的内容，请重试");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function requestRagStream(payload: unknown, signal: AbortSignal, emit: (event: RagEvent) => void) {
  const combined = AbortSignal.any([signal, workspaceRequestSignal()]);
  const response = await fetch(withBasePath("/api/rag/query"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: combined });
  combined.throwIfAborted();
  if (!response.ok) {
    const result = await response.json().catch(() => ({})); combined.throwIfAborted();
    if (response.status === 401 && result.error === "Unauthorized") {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)); throw new ApiRequestError("登录已过期，请重新登录", 401);
    }
    throw new ApiRequestError(result.error || "问答请求失败，请重试", response.status, result.code);
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("问答响应不是事件流，请重试");
  await consumeRagStream(response.body, combined, emit);
}

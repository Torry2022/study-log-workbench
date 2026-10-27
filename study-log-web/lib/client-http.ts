import { withBasePath } from "./base-path.ts";

export const AUTH_EXPIRED_EVENT = "study-log:auth-expired";

let workspaceRequests = new AbortController();
export function workspaceRequestSignal(): AbortSignal {
  return workspaceRequests.signal;
}
export function cancelWorkspaceRequests(): void {
  workspaceRequests.abort();
  workspaceRequests = new AbortController();
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function requestDownload(url: string, init?: RequestInit): Promise<{ blob: Blob; fileName: string; warningCount: number }> {
  const signal = init?.signal ? AbortSignal.any([init.signal, workspaceRequests.signal]) : workspaceRequests.signal;
  signal.throwIfAborted();
  const response = await fetch(withBasePath(url), { ...init, signal, cache: "no-store" });
  signal.throwIfAborted();
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
    signal.throwIfAborted();
    if (response.status === 401 && payload.error === "Unauthorized") {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      throw new ApiRequestError("登录已过期，请重新登录", 401, payload.code || null);
    }
    throw new ApiRequestError(payload.error || `导出失败（状态码 ${response.status}）`, response.status, payload.code || null);
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/zip") {
    throw new Error("导出响应不是 ZIP 文件，请重试");
  }
  const disposition = response.headers.get("content-disposition") || "";
  let fileName = /filename="([^"]+)"/i.exec(disposition)?.[1] || "study-log-export.zip";
  const encoded = /filename\*=UTF-8''([^;\s]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try { fileName = decodeURIComponent(encoded); } catch { /* Use the ASCII fallback. */ }
  }
  if (/[\\/\u0000-\u001f\u007f<>:"|?*]/.test(fileName) || !fileName.toLowerCase().endsWith(".zip") || fileName.startsWith(".")) {
    fileName = "study-log-export.zip";
  }
  const warning = response.headers.get("x-export-warning-count") || "0";
  const warningCount = /^\d+$/.test(warning) && Number.isSafeInteger(Number(warning)) ? Number(warning) : 0;
  const blob = await response.blob();
  signal.throwIfAborted();
  return { blob, fileName, warningCount };
}

// Only these JSON GET endpoints may be replayed; mutations retain single-attempt semantics.
const recoverableRead = (url: string, init?: RequestInit) => (!init?.method || init.method.toUpperCase() === "GET") &&
  /^\/api\/(?:logs(?:\/|$)|notes(?:\/|$)|favorites(?:\/|$)|stats(?:\/|$)|taxonomy(?:\/|$)|wiki(?:\/|$)|rag\/(?:tasks|sessions|queue)(?:\/|$)|capabilities$|auth\/me$|internal-links$|backups(?:\/|$))/.test(url.split("?")[0]);

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal ? AbortSignal.any([init.signal, workspaceRequests.signal]) : workspaceRequests.signal;
  const retry = recoverableRead(url, init);
  const started = performance.now();
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    const deadline = new AbortController();
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    const timeout = retry ? setTimeout(() => deadline.abort(), 10_000) : undefined;
    try {
      const response = await fetch(withBasePath(url), {
        ...init, signal: combined,
        headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers || {}) }
      });
      combined.throwIfAborted();
      let payload: { error?: string; code?: string };
      try { payload = await response.json(); }
      catch (failure) {
        combined.throwIfAborted();
        if (response.ok) throw new ApiRequestError("服务器响应格式异常，请重试", response.status, "INVALID_RESPONSE");
        payload = {};
      }
      combined.throwIfAborted();
      if (!response.ok) {
        const message = payload?.error || `请求失败（状态码 ${response.status}）`;
        if (response.status === 401 && message === "Unauthorized") {
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
          throw new ApiRequestError("登录已过期，请重新登录", 401, payload?.code || null);
        }
        throw new ApiRequestError(message, response.status, payload?.code || null);
      }
      return payload as T;
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 401) throw failure;
      signal?.throwIfAborted();
      const transient = deadline.signal.aborted || failure instanceof TypeError ||
        failure instanceof ApiRequestError && [502, 503, 504].includes(failure.status);
      if (retry) console.warn("[api-read]", { scope: url.split("?")[0].split("/")[2], attempt, elapsedMs: Math.round(performance.now() - started),
        status: failure instanceof ApiRequestError ? failure.status : 0,
        kind: deadline.signal.aborted ? "timeout" : failure instanceof TypeError ? "transport" : failure instanceof ApiRequestError && failure.code === "INVALID_RESPONSE" ? "parse" : "http" });
      if (!retry || !transient || attempt === 2) {
        if (deadline.signal.aborted) throw new ApiRequestError("读取超时，请重试；已有内容已保留", 0, "READ_TIMEOUT");
        if (retry && failure instanceof TypeError) throw new ApiRequestError("网络连接失败，请重试；已有内容已保留", 0, "NETWORK_ERROR");
        throw failure;
      }
    } finally { clearTimeout(timeout); }
    // A bounded retry is part of the same read and inherits its cancellation owner.
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, 350);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
}

// Both entrypoints share the same deadline and retry budget; never nest read retries.
export function requestLogJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(url, { signal });
}

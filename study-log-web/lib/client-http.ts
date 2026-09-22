import { withBasePath } from "./base-path.ts";

export const AUTH_EXPIRED_EVENT = "study-log:auth-expired";

let workspaceRequests = new AbortController();
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

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, workspaceRequests.signal])
    : workspaceRequests.signal;
  const response = await fetch(withBasePath(url), {
    ...init,
    signal,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {})
    }
  });
  const payload = (await response.json().catch((error) => {
    if (init?.signal?.aborted) throw error;
    return {};
  })) as { error?: string; code?: string };
  signal.throwIfAborted();

  if (!response.ok) {
    const message = payload.error || `请求失败（状态码 ${response.status}）`;
    if (response.status === 401) {
      if (message !== "Unauthorized") throw new ApiRequestError(message, response.status, payload.code || null);
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      throw new ApiRequestError("登录已过期，请重新登录", response.status, payload.code || null);
    }
    throw new ApiRequestError(message, response.status, payload.code || null);
  }

  return payload as T;
}

// Log reads only: a timed-out GET may be retried, while mutations keep their existing semantics.
export async function requestLogJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    let timedOut = false;
    const started = performance.now();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    let outcome = "success";
    try {
      const result = await requestJson<T>(url, { signal: controller.signal });
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      outcome = signal?.aborted ? "cancelled" : timedOut ? "timeout" : "error";
      if (signal?.aborted || !timedOut) throw error;
      if (attempt === 2) throw new Error("日志读取超时，已重试一次，请稍后刷新重试");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      const durationMs = Math.round(performance.now() - started);
      if (outcome !== "cancelled" && (durationMs >= 1000 || outcome !== "success")) {
        console.warn("[log-read]", { path: url.split("?")[0], durationMs, attempt, outcome });
      }
    }
  }
  throw new Error("日志读取失败，请重试");
}

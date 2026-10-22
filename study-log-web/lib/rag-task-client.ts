import { ApiRequestError, requestJson } from "./client-http.ts";
import { ragTaskActive, type RagTask, type RagTaskSubmission, type RagTaskSummary } from "./rag-task-types.ts";
import type { RagChatMessage, RagSession } from "./rag-types.ts";
import { withBasePath } from "./base-path.ts";

export type PendingRagTask = Omit<RagTaskSubmission, "history"> & { createdAt: string; cancelRequested?: boolean };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Request = <T>(url: string, init?: RequestInit) => Promise<T>;
type TaskEvents = (url: string, init: RequestInit & { signal: AbortSignal }, emit: (task: unknown) => Promise<void>) => Promise<void>;
export const requestRagTaskEvents: TaskEvents = async (url, init, emit) => {
  init.signal.throwIfAborted();
  const instance = new Headers(init.headers).get("X-Study-Log-Instance");
  if (!instance) throw new Error("任务事件缺少实例身份");
  // Native SSE consumes complete frames even when WebKit fetch stalls mid-frame.
  return new Promise<void>((resolve, reject) => {
    const source = new EventSource(`${withBasePath(url)}${url.includes("?") ? "&" : "?"}instance=${encodeURIComponent(instance)}`);
    let stopped = false, pending = Promise.resolve();
    const close = () => { stopped = true; source.close(); init.signal.removeEventListener("abort", abort); };
    const abort = () => { if (!stopped) { close(); resolve(); } };
    const fail = () => { if (!stopped) { close(); reject(new Error("任务事件连接中断")); } };
    init.signal.addEventListener("abort", abort, { once: true });
    source.addEventListener("snapshot", event => {
      pending = pending.then(async () => {
        if (!stopped) await emit(JSON.parse((event as MessageEvent<string>).data).task);
      }).catch(fail);
    });
    // Reconciliation owns reconnection; do not let EventSource start a second loop.
    source.addEventListener("error", fail);
  });
};
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const states = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"];
const saves = ["pending", "saved", "conflict", "error", "deleted"];
export function validRagTask(value: unknown): value is RagTask {
  const task = value as RagTask | undefined;
  return Boolean(task && uuid(task.id) && uuid(task.sessionId) && uuid(task.submissionId) &&
    Number.isSafeInteger(task.revision) && task.revision > 0 && states.includes(task.state) && saves.includes(task.saveState) &&
    typeof task.createdAt === "string" && typeof task.updatedAt === "string" && typeof task.question === "string" &&
    (task.applicable === undefined || typeof task.applicable === "boolean") &&
    (task.editMessageId === undefined || typeof task.editMessageId === "string" && task.editMessageId.length > 0 && task.editMessageId.length <= 120 && !task.replaceLast) &&
    typeof task.partial === "string" && typeof task.stage === "string" && typeof task.error === "string" && typeof task.saveError === "string" &&
    typeof task.replaceLast === "boolean" && ["logs_only", "logs_and_general"].includes(task.mode) &&
    (task.questionMessageId === undefined || typeof task.questionMessageId === "string" && !!task.questionMessageId) &&
    (task.previousAnswer === undefined || task.previousAnswer?.role === "assistant" && typeof task.previousAnswer.id === "string" && typeof task.previousAnswer.content === "string" &&
      (task.previousAnswer.citations === undefined || Array.isArray(task.previousAnswer.citations))) &&
    (task.result === null || typeof task.result?.answer === "string" && Array.isArray(task.result.citations)) &&
    (task.state !== "succeeded" || task.result?.answer.trim()));
}
export const ragTaskRetained = (task: Pick<RagTask, "state" | "saveState" | "applicable">) => task.applicable !== false && (ragTaskActive(task) || task.state === "succeeded" && task.saveState !== "saved" && task.saveState !== "deleted");
export function newestRagTask<T extends Pick<RagTask, "id" | "sessionId" | "createdAt"> & { applicable?: boolean }>(tasks: Iterable<T>, sessionId: string): T | undefined {
  let latest: T | undefined;
  for (const task of tasks) if (task.applicable !== false && task.sessionId === sessionId && (!latest || `${task.createdAt}:${task.id}` > `${latest.createdAt}:${latest.id}`)) latest = task;
  return latest;
}
export function ragTaskMessages(task: RagTask, session: RagSession | null, historical = false): RagChatMessage[] {
  if (historical) session = null;
  // The JSON session is authoritative after save, including later edits by another client.
  if (task.saveState === "saved" && session) return session.messages;
  const previous = session?.messages || [];
  const editIndex = task.editMessageId ? previous.findIndex(message => message.id === task.editMessageId && message.role === "user") : -1;
  const prefix = editIndex >= 0 ? previous.slice(0, editIndex) : task.replaceLast ? previous.slice(0, -2) : previous;
  return [...prefix, { id: task.questionMessageId || `${task.id}:user`, role: "user", content: task.question, status: "complete" },
    { id: `${task.id}:assistant`, role: "assistant", content: task.state === "succeeded" ? task.result!.answer : task.partial,
      status: ragTaskActive(task) ? "streaming" : task.state === "succeeded" ? "complete" : task.state === "cancelled" ? "stopped" : "error",
      ...(task.state === "succeeded" ? { citations: task.result!.citations, groundingWarning: task.result!.groundingWarning } : {}),
      ...(task.state === "failed" || task.state === "interrupted" ? { error: task.error || "问答中断，请重试" } : {}) }];
}

interface Callbacks {
  task: (task: RagTask) => void | Promise<void>;
  pending: (input: PendingRagTask) => void;
  rejected: (input: PendingRagTask, error: Error) => void;
  missing: (task: RagTask) => void;
  error: (message: string) => void;
}
/** One instance's durable submissions and replace-only snapshots. No answer bodies are stored in the browser. */
export class RagTaskClient {
  private readonly key: string;
  private readonly request: Request;
  private readonly controller = new AbortController();
  private readonly tasks = new Map<string, RagTask>();
  private readonly removed = new Set<string>();
  private readonly superseded = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | null = null;
  private sending = new Map<string, Promise<void>>();
  private stopped = false;
  readonly instanceId: string;
  private storage: Storage;
  private callbacks: Callbacks;
  private viewedSession = "";
  private stream: { id: string; controller: AbortController } | null = null;
  private readonly events: TaskEvents;
  constructor(instanceId: string, storage: Storage, callbacks: Callbacks, request: Request = requestJson, events: TaskEvents = requestRagTaskEvents) {
    if (!uuid(instanceId)) throw new Error("服务器实例身份无效");
    this.instanceId = instanceId; this.storage = storage; this.callbacks = callbacks;
    this.key = `study-log:rag-pending:v1:${instanceId}`;
    this.events = events;
    this.request = (url, init) => request(url, { ...init, signal: this.controller.signal,
      headers: { ...init?.headers, "X-Study-Log-Instance": instanceId } });
  }
  viewSession(id: string) { this.viewedSession = id; this.syncStream(); }
  private syncStream() {
    const latest = newestRagTask(this.tasks.values(), this.viewedSession);
    const task = latest && latest.applicable !== false && (ragTaskActive(latest) || latest.state === "succeeded" && latest.saveState === "pending") ? latest : undefined;
    if (this.stream?.id === task?.id) return;
    this.stream?.controller.abort(); this.stream = null;
    if (!task || this.stopped) return;
    const connection = { id: task.id, controller: new AbortController() }; this.stream = connection;
    void this.events(`/api/rag/tasks/${task.id}/events?after=${task.revision}`, {
      signal: connection.controller.signal, headers: { "X-Study-Log-Instance": this.instanceId }
    }, async value => { if (this.stream === connection && !connection.controller.signal.aborted) await this.accept(value, task); })
      .catch(() => { /* Polling reconciles and reconnects the same task; never resubmit a generation. */ })
      .finally(() => { if (this.stream === connection) this.stream = null; });
  }
  private pending(): PendingRagTask[] {
    const raw = this.storage.getItem(this.key);
    if (!raw) return [];
    const values: PendingRagTask[] = JSON.parse(raw);
    if (!Array.isArray(values) || values.some(value => !value || !uuid(value.submissionId) || !uuid(value.sessionId) ||
      value.baseVersion !== null && !/^[a-f0-9]{64}$/.test(value.baseVersion) ||
      typeof value.question !== "string" || !value.question.trim() || value.question.length > 2000 ||
      !["logs_only", "logs_and_general"].includes(value.mode) || typeof value.createdAt !== "string" ||
      value.replaceLast !== undefined && typeof value.replaceLast !== "boolean" ||
      value.editMessageId !== undefined && (typeof value.editMessageId !== "string" || !value.editMessageId.trim() || value.editMessageId.length > 120 || value.replaceLast === true) ||
      value.retryTaskId !== undefined && !uuid(value.retryTaskId) ||
      value.cancelRequested !== undefined && typeof value.cancelRequested !== "boolean")) throw new Error("待确认问答记录无法读取，请保留浏览器数据后重试");
    return values;
  }
  private remember(input: PendingRagTask) {
    const values = this.pending();
    this.storage.setItem(this.key, JSON.stringify([...values.filter(item => item.submissionId !== input.submissionId), input]));
  }
  private forget(id: string) {
    const values = this.pending().filter(item => item.submissionId !== id);
    if (values.length) this.storage.setItem(this.key, JSON.stringify(values)); else this.storage.removeItem(this.key);
  }
  private async accept(snapshot: unknown, expected?: Pick<RagTask, "sessionId" | "submissionId">) {
    if (!validRagTask(snapshot) || expected && (snapshot.sessionId !== expected.sessionId || snapshot.submissionId !== expected.submissionId)) throw new Error("任务快照响应不完整，请重新连接");
    let value = snapshot;
    if (this.stopped || this.removed.has(value.id)) return;
    if (value.applicable === false) this.superseded.add(value.id);
    if (this.superseded.has(value.id)) value = { ...value, applicable: false };
    const old = this.tasks.get(value.id);
    if (old && old.revision > value.revision) {
      if (value.applicable !== false || old.applicable === false) return;
      value = { ...old, applicable: false };
    }
    if (old && old.revision >= value.revision && old.applicable === value.applicable) return;
    this.tasks.set(value.id, value);
    this.syncStream();
    await this.callbacks.task(value);
  }
  private send(input: PendingRagTask): Promise<void> {
    const existing = this.sending.get(input.submissionId); if (existing) return existing;
    const work = (async () => {
      try {
        const { createdAt: _time, cancelRequested: _cancel, ...body } = input;
        const result = await this.request<{ task: RagTask }>("/api/rag/tasks", { method: "POST", body: JSON.stringify(body) });
        await this.accept(result.task, input);
        if (this.stopped) return;
        const pending = this.pending().find(item => item.submissionId === input.submissionId);
        if (pending?.cancelRequested) await this.cancel(result.task.id);
        this.forget(input.submissionId);
      } catch (error) {
        if (this.stopped) return;
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
          this.forget(input.submissionId); this.callbacks.rejected(input, error);
        } else this.callbacks.error("提交结果尚未确认，正在用原提交标识重连；不会另建一次问答。");
      }
    })().finally(() => { this.sending.delete(input.submissionId); });
    this.sending.set(input.submissionId, work); return work;
  }
  async submit(input: PendingRagTask) {
    // Persist before the first POST. A storage failure must not start an unrecoverable request.
    this.remember(input); this.callbacks.pending(input); await this.send(input);
  }
  track(task: RagTask) {
    // A new viewing connection must still reconcile tasks known by the retained workspace,
    // even when the server has since moved them into saved history.
    if (validRagTask(task)) {
      if (task.applicable === false) this.superseded.add(task.id);
      const old = this.tasks.get(task.id);
      if (old && old.revision > task.revision) return;
      this.tasks.set(task.id, this.superseded.has(task.id) ? { ...task, applicable: false } : task); this.syncStream();
    }
  }
  async refresh() {
    if (this.stopped) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const result = await this.request<{ tasks: RagTaskSummary[] }>("/api/rag/tasks");
        if (this.stopped) return;
        if (!Array.isArray(result.tasks) || result.tasks.some(task => !uuid(task.id) || !uuid(task.sessionId) || !uuid(task.submissionId) || !states.includes(task.state) || !saves.includes(task.saveState) || !Number.isSafeInteger(task.revision))) throw new Error("任务列表响应不完整");
        const latest = new Map<string, RagTaskSummary>();
        for (const task of result.tasks) {
          if (task.applicable === false || this.superseded.has(task.id)) {
            this.superseded.add(task.id);
            const known = this.tasks.get(task.id);
            if (known && known.applicable !== false) await this.accept({ ...known, applicable: false });
            continue;
          }
          const old = latest.get(task.sessionId);
          if (!old || `${task.createdAt}:${task.id}` > `${old.createdAt}:${old.id}`) latest.set(task.sessionId, task);
        }
        const retainedSessions = new Set(result.tasks.filter(ragTaskRetained).map(task => task.sessionId));
        await Promise.all(result.tasks.filter(task => {
          const old = this.tasks.get(task.id);
          if (old) return old.revision < task.revision || old.applicable !== task.applicable;
          // Unresolved results are not history: a newer task in the same session cannot hide them.
          return ragTaskRetained(task) || latest.get(task.sessionId)?.id === task.id &&
            (task.saveState !== "saved" && task.saveState !== "deleted" || retainedSessions.has(task.sessionId));
        }).map(async task => {
          try { await this.accept((await this.request<{ task: RagTask }>(`/api/rag/tasks/${task.id}`)).task, task); }
          catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              const old = this.tasks.get(task.id); this.removed.add(task.id); this.tasks.delete(task.id); if (old && !this.stopped) this.callbacks.missing(old);
            } else throw error;
          }
        }));
        // A deleted session can disappear from the list before its subscription observes 404.
        for (const task of this.tasks.values()) if (task.saveState !== "saved" && !result.tasks.some(item => item.id === task.id)) {
          try { await this.accept((await this.request<{ task: RagTask }>(`/api/rag/tasks/${task.id}`)).task, task); }
          catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) { this.removed.add(task.id); this.tasks.delete(task.id); if (!this.stopped) this.callbacks.missing(task); }
            else throw error;
          }
        }
        for (const input of this.pending()) {
          this.callbacks.pending(input);
          const found = result.tasks.find(task => task.submissionId === input.submissionId);
          if (found) {
            await this.accept((await this.request<{ task: RagTask }>(`/api/rag/tasks/${found.id}`)).task, input);
            if (input.cancelRequested) await this.cancel(found.id);
            this.forget(input.submissionId);
          } else await this.send(input);
        }
        if (!this.stopped && !this.pending().length) this.callbacks.error("");
      } catch (error) { if (!this.stopped) this.callbacks.error(error instanceof Error ? error.message : "任务状态读取失败，请重试"); }
    })().finally(() => { this.refreshing = null; this.syncStream(); });
    return this.refreshing;
  }
  start() {
    const tick = async () => { await this.refresh(); if (!this.stopped) this.timer = setTimeout(tick, 1000); };
    void tick();
  }
  async cancel(id: string) { const result = await this.request<{ task: RagTask }>(`/api/rag/tasks/${id}/cancel`, { method: "POST" }); await this.accept(result.task); }
  async stopSession(id: string) {
    const pending = this.pending().filter(input => input.sessionId === id);
    for (const input of pending) { this.remember({ ...input, cancelRequested: true }); this.callbacks.pending({ ...input, cancelRequested: true }); }
    for (const task of this.tasks.values()) if (task.sessionId === id && ragTaskActive(task)) await this.cancel(task.id);
  }
  async save(id: string) { const result = await this.request<{ task: RagTask }>(`/api/rag/tasks/${id}/save`, { method: "POST" }); await this.accept(result.task); }
  async select(id: string) {
    let result: { task: RagTask };
    try { result = await this.request<{ task: RagTask }>(`/api/rag/tasks/${id}`); }
    catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        const old = this.tasks.get(id); this.removed.add(id); this.tasks.delete(id); if (old && !this.stopped) this.callbacks.missing(old);
      }
      throw error;
    }
    if (!validRagTask(result.task) || result.task.id !== id) throw new Error("任务快照响应不完整，请重试");
    if (this.stopped || this.removed.has(id)) return;
    const old = this.tasks.get(id);
    await this.accept(result.task);
    if (this.tasks.get(id) === old && old) await this.callbacks.task(old);
  }
  async readSession(sessionId: string) {
    if (!uuid(sessionId)) throw new Error("会话标识无效");
    const result = await this.request<{ tasks: RagTaskSummary[] }>(`/api/rag/tasks?sessionId=${encodeURIComponent(sessionId)}`);
    if (!Array.isArray(result.tasks) || result.tasks.some(task => !uuid(task.id) || task.sessionId !== sessionId || !uuid(task.submissionId) || !Number.isSafeInteger(task.revision))) throw new Error("回答版本列表响应不完整");
    for (const task of result.tasks) {
      if (task.applicable === false) {
        this.superseded.add(task.id);
        const known = this.tasks.get(task.id);
        if (known && known.applicable !== false) await this.accept({ ...known, applicable: false });
      }
      if (this.tasks.has(task.id) && this.tasks.get(task.id)!.revision >= task.revision && this.tasks.get(task.id)!.applicable === task.applicable) continue;
      const value = (await this.request<{ task: RagTask }>(`/api/rag/tasks/${task.id}`)).task;
      if (value?.id !== task.id) throw new Error("回答版本身份不匹配");
      await this.accept(value, task);
    }
  }
  async remove(id: string) { const result = await this.request<{ removed: boolean }>(`/api/rag/tasks/${id}`, { method: "DELETE" }); if (result.removed !== true) throw new Error("放弃结果尚未确认，请保留回答并重试"); this.removed.add(id); this.tasks.delete(id); }
  stop() { this.stopped = true; clearTimeout(this.timer); this.controller.abort(); this.stream?.controller.abort(); this.stream = null; }
}

import { randomUUID } from "node:crypto";
import { getLogRoot } from "./config.ts";
import { configureRagThinking, getChatConfig, getLightChatConfig } from "./ai-config.ts";
import { getMcpConfig } from "./mcp-config.ts";
import { createRagQueryStream, type RagQueryConfig, type RagQueryInput } from "./rag-query.ts";
import { applyRagTaskResult, ensureRagTaskSessionFormat, inspectRagTaskSession, inspectRagTaskSessions, deletedRagSessionIds, RagSessionConflictError, RagSessionNotFoundError, RagSessionInputError } from "./rag-sessions-store.ts";
import { RagTaskError, RagTaskStore, type TaskRecord } from "./rag-task-store.ts";
import type { RagTask, RagTaskResult, RagTaskSubmission, RagTaskSummary } from "./rag-task-types.ts";
import { parseRagHistory } from "./rag-answer.ts";

export function ragExecutionConfig(): RagQueryConfig {
  const chat = configureRagThinking(getChatConfig()), lightChat = getLightChatConfig();
  if (lightChat.model === chat.model && chat.thinkingMode) lightChat.thinkingMode = chat.thinkingMode;
  return { chat, lightChat, mcp: getMcpConfig() };
}
type Execute = (input: RagQueryInput, signal: AbortSignal) => ReadableStream<Uint8Array>;
const publicValue = (task: TaskRecord): RagTask => {
  const { input: _input, generation: _generation, fingerprint: _fingerprint, owner: _owner, ...value } = task;
  return { ...value, replaceLast: task.input.replaceLast === true,
    ...(task.input.editMessageId ? { editMessageId: task.input.editMessageId } : {}),
    questionMessageId: task.input.questionMessageId || (!task.input.replaceLast ? `${task.id}:user` : undefined),
    ...(task.input.previousAnswer ? { previousAnswer: task.input.previousAnswer } : {}) };
};
export class RagTaskRuntime {
  readonly owner = `${process.pid}:${randomUUID()}`;
  readonly store: RagTaskStore;
  private controller: AbortController | null = null;
  private executing: string | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private ticking = false;
  private execute: Execute;
  constructor(root: string, execute: Execute = (input, signal) => createRagQueryStream(input, ragExecutionConfig(), signal)) {
    this.execute = execute;
    this.store = new RagTaskStore(root);
  }
  start() {
    if (this.interval || this.stopped) return;
    this.interval = setInterval(() => { void this.tick(); }, 200); this.interval.unref();
    void this.tick();
  }
  async create(input: RagTaskSubmission): Promise<RagTask> {
    const existing = this.store.submitted(input.submissionId);
    let history = input.history;
    let association: Pick<TaskRecord["input"], "questionMessageId" | "previousAnswer" | "parentQuestionIds" | "replacedQuestionIds"> = {};
    if (!existing) {
      let current;
      try { current = await inspectRagTaskSession(input.sessionId, input.baseVersion); }
      catch (error) { if (error instanceof RagSessionInputError) throw new RagTaskError("RAG_INVALID_INPUT", "会话标识无效", 400); throw error; }
      if (current.deleted) throw new RagTaskError("RAG_SESSION_DELETED", "会话已删除，不会重新创建", 410);
      if (!current.matchesBaseVersion) throw new RagTaskError("RAG_SESSION_CONFLICT", "会话已变化，请重新读取", 409);
      const messages = current.session?.messages || [];
      const editIndex = input.editMessageId === undefined ? -1 : messages.findIndex(message => message.id === input.editMessageId && message.role === "user");
      if (input.editMessageId !== undefined && (editIndex < 0 || input.replaceLast || input.baseVersion === null)) throw new RagTaskError("RAG_SESSION_CONFLICT", "要修改的问题已变化，请重新读取", 409);
      if (input.replaceLast && (messages.length < 2 || messages.at(-2)?.content !== input.question)) throw new RagTaskError("RAG_SESSION_CONFLICT", "要重新生成的问题已变化，请重新读取", 409);
      if (input.replaceLast) association = { questionMessageId: messages.at(-2)!.id, previousAnswer: messages.at(-1)! };
      if (input.retryTaskId) {
        const previous = this.store.get(input.retryTaskId);
        const latest = this.store.list(input.sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1);
        if (previous.sessionId !== input.sessionId || previous.question !== input.question ||
          latest?.id !== previous.id || previous.input.editMessageId !== input.editMessageId || Boolean(previous.input.replaceLast) !== Boolean(input.replaceLast) || !["failed", "cancelled", "interrupted"].includes(previous.state))
          throw new RagTaskError("RAG_INVALID_INPUT", "要重试的问答任务不匹配", 400);
        association.questionMessageId = previous.input.questionMessageId || association.questionMessageId || `${previous.id}:user`;
      }
      if (!current.session && input.history.length) throw new RagTaskError("RAG_INVALID_INPUT", "请先保存原会话，再继续后台问答", 400);
      const prefix = editIndex >= 0 ? messages.slice(0, editIndex) : input.replaceLast ? messages.slice(0, -2) : messages;
      association.parentQuestionIds = prefix.filter(message => message.role === "user").map(message => message.id);
      if (editIndex >= 0) association.replacedQuestionIds = messages.slice(editIndex).filter(message => message.role === "user").map(message => message.id);
      history = parseRagHistory(prefix.map(({ role, content, citations }) => ({ role, content,
        ...(citations?.length ? { sourceRefs: citations.map(({ date, fileName, heading, contentHash }) => ({ date, fileName, heading, contentHash })) } : {}) })));
    }
    await ensureRagTaskSessionFormat();
    const task = this.store.create(input, history, association);
    void this.tick(); return this.get(task.id);
  }
  async get(id: string): Promise<RagTask> {
    const task = this.store.get(id);
    const current = await inspectRagTaskSession(task.sessionId);
    if (current.deleted) {
      this.store.scrubSession(task.sessionId); throw new RagTaskError("RAG_TASK_NOT_FOUND", "会话及所属任务已删除", 404);
    }
    const applicable = current.session ? this.store.branchApplicability(task.sessionId, current.session.messages, current.appliedTaskIds).get(id) !== false : true;
    return { ...publicValue(task), ...(!applicable ? { applicable: false } : {}) };
  }
  async list(sessionId?: string): Promise<RagTaskSummary[]> {
    const tasks = this.store.list(sessionId);
    if (!tasks.length) return tasks;
    const sessions = await inspectRagTaskSessions(tasks.map(task => task.sessionId));
    const applicability = new Map<string, boolean>();
    for (const [id, current] of sessions) {
      if (current.deleted) { this.store.scrubSession(id); continue; }
      if (current.session) for (const [taskId, applicable] of this.store.branchApplicability(id, current.session.messages, current.appliedTaskIds)) applicability.set(taskId, applicable);
    }
    return tasks.filter(task => !sessions.get(task.sessionId)?.deleted).map(task => applicability.get(task.id) === false ? { ...task, applicable: false } : task);
  }
  async cancel(id: string) {
    await this.get(id);
    this.store.cancel(id);
    if (this.executing === id) this.controller?.abort();
    return this.get(id);
  }
  async remove(id: string) {
    await this.get(id); this.store.remove(id);
    if (this.executing === id) this.controller?.abort();
  }
  async save(id: string): Promise<RagTask> {
    if ((await this.get(id)).applicable === false) throw new RagTaskError("RAG_TASK_SUPERSEDED", "该结果属于修改前的分支，未写入当前会话", 409);
    const task = this.store.get(id);
    if (task.state !== "succeeded" || !task.result) throw new RagTaskError("RAG_TASK_NOT_COMPLETE", "任务尚无完整结果");
    try {
      await applyRagTaskResult({ taskId: task.id, sessionId: task.sessionId, baseVersion: task.input.baseVersion,
        question: task.input.question, answerMode: task.input.mode, answer: task.result.answer,
        questionMessageId: task.input.questionMessageId,
        ...(task.input.editMessageId ? { editMessageId: task.input.editMessageId } : {}),
        citations: task.result.citations, ...(task.result.groundingWarning ? { groundingWarning: task.result.groundingWarning } : {}),
        ...(task.input.replaceLast ? { replaceLast: true } : {}) });
      this.store.saved(id, "saved");
    } catch (error) {
      if (error instanceof RagSessionNotFoundError) { this.store.scrubSession(task.sessionId); throw new RagTaskError("RAG_TASK_NOT_FOUND", "会话已删除", 404); }
      this.store.saved(id, error instanceof RagSessionConflictError ? "conflict" : "error",
        error instanceof RagSessionConflictError ? "会话已被另一端修改；完整结果仍可查看，未覆盖会话" : "回答已保留，写入会话失败；仅重试保存即可");
    }
    return this.get(id);
  }
  async tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      if (!this.store.leader(this.owner)) { this.controller?.abort(); return; }
      for (const id of await deletedRagSessionIds()) this.store.scrubSession(id);
      if (this.executing) {
        const current = this.store.get(this.executing, true);
        if (current.state !== "running") this.controller?.abort();
        if ((await inspectRagTaskSession(current.sessionId)).deleted) { this.store.scrubSession(current.sessionId); this.controller?.abort(); }
        return;
      }
      // No execution promise remains for this owner. A failed final write must not leave running forever.
      this.store.interruptOrphans(this.owner);
      // Reconcile a durable result after a crash between JSON replacement and the SQLite receipt.
      for (const task of this.store.pendingSaves()) {
        try { await this.save(task.id); } catch (error) { if (!(error instanceof RagTaskError && error.status === 404)) throw error; }
      }
      const task = this.store.claim(this.owner);
      if (task) {
        this.executing = task.id; this.controller = new AbortController();
        void this.run(task, this.controller).finally(() => { this.executing = null; this.controller = null; });
      }
    } catch { this.controller?.abort(); /* Fail closed: no model call if storage/ownership is unavailable. */ }
    finally { this.ticking = false; }
  }
  private async run(task: TaskRecord, controller: AbortController) {
    let partial = "", stage = "正在准备问答", result: RagTaskResult | null = null, lastWrite = 0, dirty = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const flush = () => { this.store.progress(task, partial, stage); lastWrite = Date.now(); dirty = false; };
    const checkpoint = setInterval(() => {
      if (dirty && !controller.signal.aborted) { try { flush(); } catch { controller.abort(); } }
    }, 250); checkpoint.unref();
    try {
      if ((await inspectRagTaskSession(task.sessionId)).deleted) { this.store.scrubSession(task.sessionId); return; }
      reader = this.execute(task.input, controller.signal).getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "", bytes = 0;
      while (!result) {
        const next = await reader.read(); controller.signal.throwIfAborted();
        if (next.done) break;
        bytes += next.value.length; if (bytes > 4 * 1024 * 1024) throw new Error("问答输出超过限制");
        buffer += decoder.decode(next.value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const raw = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
          const lines = raw.split(/\r?\n/), event = lines.find(line => line.startsWith("event:"))?.slice(6).trim();
          const json = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (!json) continue;
          const data = JSON.parse(json);
          if (event === "status") { stage = data.message; flush(); }
          if (event === "delta") {
            const firstFragment = !partial && Boolean(data.text);
            partial += data.text; dirty = true;
            // A status checkpoint must not defer the first durable answer fragment.
            if (firstFragment || Date.now() - lastWrite >= 250) flush();
          }
          if (partial.length > 120000) throw new Error("问答输出超过限制");
          if (event === "error") {
            result = { answer: partial, citations: [], ...(data.diagnostics ? { diagnostics: data.diagnostics } : {}) };
            this.store.finish(task, "failed", result, data.message || "问答失败", typeof data.code === "string" ? data.code : "RAG_QUERY_FAILED"); return;
          }
          if (event === "done") {
            if (typeof data.answer !== "string" || !data.answer.trim() || !Array.isArray(data.citations)) throw new Error("问答完成响应不完整");
            result = { answer: data.answer, citations: data.citations,
              ...(data.groundingWarning ? { groundingWarning: data.groundingWarning } : {}), ...(data.diagnostics ? { diagnostics: data.diagnostics } : {}) };
            break;
          }
        }
        if (buffer.length > 512 * 1024) throw new Error("问答单条响应超过限制");
      }
      controller.signal.throwIfAborted();
      if (!result) throw new Error("回答连接提前结束，已保留收到的片段");
      if (this.store.finish(task, "succeeded", result)) await this.save(task.id);
    } catch (error) {
      const aborted = controller.signal.aborted;
      controller.abort();
      try {
        this.store.progress(task, partial, stage);
        this.store.finish(task, this.stopped ? "interrupted" : "failed", result,
          aborted ? "问答中断；片段已保留，不会自动重试" : "问答执行失败；片段已保留，不会自动重试",
          aborted ? "RAG_CANCELLED" : "RAG_QUERY_FAILED");
      } catch { /* The next tick reconciles an ended executor; a new owner also recovers on restart. */ }
    } finally {
      clearInterval(checkpoint);
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
      try { this.store.release(task.id); } catch { /* A database failure remains visible to subsequent requests. */ }
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; if (this.interval) clearInterval(this.interval);
    this.controller?.abort(); this.store.shutdown(this.owner);
  }
}

const key = Symbol.for("study-log.rag-task-runtime.v1");
type Registry = typeof globalThis & { [key]?: RagTaskRuntime };
export function currentRagTaskRuntime(): RagTaskRuntime | undefined { return (globalThis as Registry)[key]; }
export function startRagTaskRuntime(): RagTaskRuntime {
  const registry = globalThis as Registry;
  if (registry[key]) return registry[key];
  const runtime = new RagTaskRuntime(getLogRoot()); registry[key] = runtime;
  runtime.start();
  const stop = () => { try { runtime.stop(); } catch { /* Startup recovery handles a failed shutdown write. */ } };
  process.once("SIGINT", stop); process.once("SIGTERM", stop); process.once("exit", stop);
  return runtime;
}

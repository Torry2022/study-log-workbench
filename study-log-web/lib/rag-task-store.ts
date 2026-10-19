import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RagTask, RagTaskResult, RagTaskSubmission, RagTaskState, RagTaskSummary } from "./rag-task-types.ts";
import type { RagHistoryMessage } from "./rag-types.ts";

const taskErrorIdentity = Symbol.for("study-log.rag-task-error.v1");
export class RagTaskError extends Error {
  readonly [taskErrorIdentity] = true;
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
// Next instrumentation and route bundles do not share class constructors.
export function isRagTaskError(error: unknown): error is RagTaskError {
  return error instanceof Error && (error as RagTaskError)[taskErrorIdentity] === true;
}
export interface TaskRecord extends RagTask { input: RagTaskSubmission; generation: number; fingerprint: string; owner: string | null }
const now = () => new Date().toISOString();
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const fail = (code: string, message: string, status = 409): never => { throw new RagTaskError(code, message, status); };
// Runtime ownership is local to this single-instance Node deployment. Never infer death from EPERM.
function ownerExited(owner: string): boolean {
  const pid = /^(\d+):/.exec(owner)?.[1];
  if (!pid || !Number.isSafeInteger(Number(pid))) return false;
  try { process.kill(Number(pid), 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

export class RagTaskStore {
  private db: DatabaseSync;
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    if (!path.isAbsolute(root)) throw new Error("Explicit task data root required");
    let current = path.parse(root).root;
    for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part); const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe task data root");
    }
    const state = path.join(root, "state"); fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(state).isSymbolicLink()) throw new Error("Unsafe task state directory");
    const file = path.join(state, "rag-tasks.sqlite");
    for (const candidate of [file, `${file}-journal`]) {
      if (fs.existsSync(candidate)) {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Unsafe task database");
      }
    }
    this.db = new DatabaseSync(file);
    const schema = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (schema > 2) { this.db.close(); throw new Error("Task database requires a newer application"); }
    this.db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA max_page_count=32768;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, submission_id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      state TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0, owner TEXT, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, input TEXT NOT NULL, partial TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '', result TEXT, error TEXT NOT NULL DEFAULT '', save_state TEXT NOT NULL DEFAULT 'pending',
      save_error TEXT NOT NULL DEFAULT '', removed INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS active_session ON tasks(session_id) WHERE state IN ('queued','running');
      CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS worker (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
      `);
    if (!(this.db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).some(column => column.name === "error_code")) this.db.exec("ALTER TABLE tasks ADD COLUMN error_code TEXT NOT NULL DEFAULT ''");
    this.db.exec("PRAGMA user_version=2");
    fs.chmodSync(file, 0o600);
  }
  close() { this.db.close(); }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private decode(row: Record<string, unknown>): TaskRecord {
    const input = JSON.parse(row.input as string) as RagTaskSubmission;
    return { id: row.id as string, sessionId: row.session_id as string, submissionId: row.submission_id as string,
      state: row.state as RagTaskState, revision: row.revision as number, createdAt: row.created_at as string,
      updatedAt: row.updated_at as string, question: input.question || "", mode: input.mode || "logs_only", input,
      partial: row.partial as string, stage: row.stage as string, result: row.result ? JSON.parse(row.result as string) : null,
      error: row.error as string, errorCode: row.error_code as string, saveState: row.save_state as RagTask["saveState"], saveError: row.save_error as string,
      generation: row.generation as number, fingerprint: row.fingerprint as string, owner: row.owner as string | null };
  }
  get(id: string, includeRemoved = false): TaskRecord {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id=? ${includeRemoved ? "" : "AND removed=0"}`).get(id);
    if (!row) return fail("RAG_TASK_NOT_FOUND", "任务不存在或已删除", 404);
    return this.decode(row as Record<string, unknown>);
  }
  list(): RagTaskSummary[] {
    const attention = "(state IN ('queued','running') OR state='succeeded' AND save_state IN ('pending','error','conflict'))";
    const rows = this.db.prepare(`WITH history AS (
      SELECT id FROM tasks WHERE removed=0 AND NOT ${attention} ORDER BY created_at DESC,id DESC LIMIT 100
    ) SELECT id,session_id,submission_id,state,revision,created_at,updated_at,stage,error_code,save_state,
      substr(json_extract(input,'$.question'),1,160) AS question_preview,json_extract(input,'$.mode') AS mode
      FROM tasks WHERE removed=0 AND (${attention} OR id IN (SELECT id FROM history))
      ORDER BY CASE WHEN ${attention} THEN 0 ELSE 1 END,created_at DESC,id DESC`).all();
    return rows.map(row => ({ id: row.id as string, sessionId: row.session_id as string, submissionId: row.submission_id as string,
      state: row.state as RagTaskState, revision: row.revision as number, createdAt: row.created_at as string, updatedAt: row.updated_at as string,
      stage: row.stage as string, errorCode: row.error_code as string, saveState: row.save_state as RagTask["saveState"],
      questionPreview: row.question_preview as string, mode: row.mode as RagTask["mode"] }));
  }
  pendingSaves(): TaskRecord[] {
    return this.db.prepare("SELECT * FROM tasks WHERE removed=0 AND state='succeeded' AND save_state='pending' ORDER BY created_at,id").all().map(row => this.decode(row as Record<string, unknown>));
  }
  /** Only called by the leader after its registered execution has fully settled. */
  interruptOrphans(owner: string) {
    this.transaction(() => {
      const rows = this.db.prepare(`UPDATE tasks SET state='interrupted',generation=generation+1,revision=revision+1,
        stage='',error='执行已结束但状态未完整保存，任务已中断，不会自动重试',error_code='RAG_TASK_INTERRUPTED',updated_at=?
        WHERE owner=? AND state='running' AND removed=0 RETURNING id`).all(now(), owner);
      for (const row of rows) this.db.prepare("DELETE FROM leases WHERE id=? AND owner=?").run(row.id as string, owner);
    });
  }
  submitted(id: string): TaskRecord | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE submission_id=?").get(id);
    return row ? this.decode(row as Record<string, unknown>) : null;
  }
  create(input: RagTaskSubmission, history: RagHistoryMessage[] = input.history): TaskRecord {
    if (!uuid(input.submissionId) || !uuid(input.sessionId) || (input.baseVersion !== null && (typeof input.baseVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.baseVersion))) ||
      typeof input.question !== "string" || !input.question.trim() || input.question.length > 2000 || !["logs_only", "logs_and_general"].includes(input.mode) ||
      !Array.isArray(input.history) || Buffer.byteLength(JSON.stringify(input)) > 128 * 1024) fail("RAG_INVALID_INPUT", "任务请求无效", 400);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM tasks WHERE submission_id=?").get(input.submissionId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return fail("RAG_SUBMISSION_CONFLICT", "提交标识已用于其他内容");
        if (existing.removed) return fail("RAG_SUBMISSION_REMOVED", "该提交已删除，不会重新执行", 410);
        return this.decode(existing as Record<string, unknown>);
      }
      if (this.db.prepare("SELECT id FROM tasks WHERE session_id=? AND removed=0 AND (state IN ('queued','running') OR state='succeeded' AND save_state='pending')").get(input.sessionId)) fail("RAG_SESSION_BUSY", "该会话正在执行或保存回答");
      if ((this.db.prepare("SELECT count(*) AS n FROM tasks WHERE state='queued'").get() as { n: number }).n >= 8) fail("RAG_QUEUE_FULL", "等待任务已满，请稍后提交", 429);
      if ((this.db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n >= 10000) fail("RAG_TASK_CAPACITY", "任务身份记录已达容量，请先备份并联系维护者", 507);
      const id = randomUUID(), time = now();
      this.db.prepare("INSERT INTO tasks(id,submission_id,session_id,fingerprint,state,created_at,updated_at,input) VALUES(?,?,?,?,'queued',?,?,?)")
        .run(id, input.submissionId, input.sessionId, fingerprint, time, time, JSON.stringify({ ...input, history }));
      return this.get(id);
    });
  }
  leader(owner: string): boolean {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM worker WHERE id=1").get();
      if (row && row.owner !== owner && Number(row.expires) > Date.now() && !ownerExited(row.owner as string)) return false;
      const replaced = row?.owner !== owner;
      this.db.prepare("INSERT INTO worker VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires").run(owner, Date.now() + 5000);
      if (replaced) {
        this.db.prepare("UPDATE tasks SET state='interrupted',generation=generation+1,revision=revision+1,error='服务器已重启，任务未自动重试',updated_at=? WHERE state='running'").run(now());
        // A legacy stream is not recoverable either. Do not replay it on restart.
        this.db.prepare("DELETE FROM leases WHERE expires<?").run(Date.now());
      }
      return true;
    });
  }
  private acquire(owner: string, kind: string, id: string): boolean {
    this.db.prepare("DELETE FROM leases WHERE expires<?").run(Date.now());
    for (const row of this.db.prepare("SELECT id,owner FROM leases").all()) {
      if (ownerExited(row.owner as string)) this.db.prepare("DELETE FROM leases WHERE id=? AND owner=?").run(row.id as string, row.owner as string);
    }
    if (this.db.prepare("SELECT id FROM leases LIMIT 1").get()) return false;
    this.db.prepare("INSERT INTO leases VALUES(?,?,?,?)").run(id, owner, kind, Date.now() + 130000); return true;
  }
  legacy(owner: string): string | null {
    return this.transaction(() => { const id = randomUUID(); return this.acquire(owner, "legacy", id) ? id : null; });
  }
  release(id: string) { this.db.prepare("DELETE FROM leases WHERE id=?").run(id); }
  claim(owner: string): TaskRecord | null {
    return this.transaction(() => {
      const leader = this.db.prepare("SELECT * FROM worker WHERE id=1").get();
      if (leader?.owner !== owner || Number(leader.expires) < Date.now()) return null;
      const row = this.db.prepare("SELECT id FROM tasks WHERE state='queued' ORDER BY created_at,id LIMIT 1").get();
      if (!row || !this.acquire(owner, "task", row.id as string)) return null;
      this.db.prepare("UPDATE tasks SET state='running',owner=?,generation=generation+1,revision=revision+1,stage='正在准备问答',updated_at=? WHERE id=? AND state='queued'").run(owner, now(), row.id as string);
      return this.get(row.id as string);
    });
  }
  progress(task: TaskRecord, partial: string, stage: string) {
    if (partial.length > 120000) throw new Error("Task output limit exceeded");
    this.db.prepare("UPDATE tasks SET partial=?,stage=?,updated_at=?,revision=revision+1 WHERE id=? AND state='running' AND generation=? AND owner=?")
      .run(partial, stage.slice(0, 300), now(), task.id, task.generation, task.owner);
  }
  finish(task: TaskRecord, state: "succeeded" | "failed" | "interrupted", result: RagTaskResult | null, error = "", code = ""): boolean {
    if (result && Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024) throw new Error("Task result limit exceeded");
    return this.transaction(() => {
      const change = this.db.prepare("UPDATE tasks SET state=?,result=?,partial=COALESCE(?,partial),error=?,error_code=?,stage='',updated_at=?,revision=revision+1 WHERE id=? AND state='running' AND generation=? AND owner=? AND removed=0")
        .run(state, result ? JSON.stringify(result) : null, result?.answer ?? null, error.slice(0, 2000), code.slice(0, 100), now(), task.id, task.generation, task.owner);
      if (change.changes) this.release(task.id);
      return Number(change.changes) > 0;
    });
  }
  cancel(id: string): TaskRecord {
    this.db.prepare("UPDATE tasks SET state='cancelled',generation=generation+1,revision=revision+1,stage='',updated_at=? WHERE id=? AND state IN ('queued','running')").run(now(), id);
    // A running call keeps its resource lease until the executor observes cancellation.
    return this.get(id);
  }
  saved(id: string, state: RagTask["saveState"], error = "") {
    this.db.prepare("UPDATE tasks SET save_state=?,save_error=?,revision=revision+1,updated_at=? WHERE id=? AND state='succeeded' AND removed=0")
      .run(state, error.slice(0, 2000), now(), id);
  }
  remove(id: string) {
    this.cancel(id);
    this.db.prepare("UPDATE tasks SET input='{}',partial='',result=NULL,error='',error_code='',stage='',save_error='',save_state='deleted',removed=1,revision=revision+1,updated_at=? WHERE id=?").run(now(), id);
  }
  scrubSession(sessionId: string) {
    this.db.prepare(`UPDATE tasks SET state=CASE WHEN state IN ('queued','running') THEN 'cancelled' ELSE state END,
      generation=generation+1,input='{}',partial='',result=NULL,error='',error_code='',stage='',save_error='',save_state='deleted',removed=1,
      revision=revision+1,updated_at=? WHERE session_id=? AND removed=0`).run(now(), sessionId);
  }
  shutdown(owner: string) {
    this.db.prepare("UPDATE tasks SET state='interrupted',generation=generation+1,revision=revision+1,error='服务已停止，任务未自动重试',updated_at=? WHERE state='running' AND owner=?").run(now(), owner);
    this.db.prepare("DELETE FROM worker WHERE owner=?").run(owner);
    // Running/legacy calls release after upstream cleanup, or are recovered after process death.
  }
}

/** Called after the JSON tombstone commits; failure is recoverable from that tombstone. */
export function scrubStoredRagTasks(root: string, sessionId: string) {
  if (!fs.existsSync(path.join(root, "state", "rag-tasks.sqlite"))) return;
  const store = new RagTaskStore(root);
  try { store.scrubSession(sessionId); } finally { store.close(); }
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackupRoot, getLogRoot } from "./config.ts";
import { isValidLogDate } from "./study-date.ts";
import type { RagAnswerMode, RagChatMessage, RagCitation, RagSession, RagSessionSummary } from "./rag-types.ts";

export class RagSessionInputError extends Error {}
export class RagSessionConflictError extends Error {
  readonly code = "RAG_SESSION_CONFLICT";
  constructor() { super("问答会话已变化，未覆盖；请保留当前回答并重新读取后核对"); }
}
export class RagSessionNotFoundError extends Error { constructor() { super("问答会话不存在"); } }
export class RagSessionStorageError extends Error { constructor() { super("问答历史存储异常，请保留当前回答并检查存储状态"); } }
type TitleSource = "fallback" | "generated" | "manual";
interface SessionRecord {
  id: string; title: string; titleSource: TitleSource; createdAt: string; updatedAt: string;
  answerMode: RagAnswerMode; messages: RagChatMessage[]; lastMutationId: string; fingerprint: string;
}
interface Tombstone { id: string; mutationId: string; fingerprint: string; baseVersion: string; deletedAt: string }
interface SessionsFile { schemaVersion: 1; sessions: SessionRecord[]; tombstones: Tombstone[] }
export interface SaveRagSessionInput { mutationId: string; baseVersion: string | null; answerMode: RagAnswerMode; messages: RagChatMessage[] }
export interface CreateRagSessionInput extends SaveRagSessionInput { id: string; baseVersion: null }
export interface RenameRagSessionInput { mutationId: string; baseVersion: string; title: string }
export interface DeleteRagSessionInput { mutationId: string; baseVersion: string }
const FILE_NAME = "rag-sessions.json";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const queues = new Map<string, Promise<unknown>>();
const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const version = (record: SessionRecord) => hash(JSON.stringify(record));
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RagSessionInputError("会话字段必须是对象");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RagSessionInputError("会话包含不支持的字段");
}
function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) throw new RagSessionInputError(`${label}无效或超过长度限制`);
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new RagSessionInputError("会话与操作标识必须是UUID");
  return value.toLowerCase();
}
function baseVersion(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new RagSessionInputError("必须提供有效的baseVersion");
  return value;
}
function citation(input: unknown): RagCitation {
  const value = object(input);
  fields(value, ["sourceId", "date", "month", "fileName", "heading", "headingIndex", "chunkId", "contentHash", "excerpt"]);
  if (typeof value.sourceId !== "string" || !/^S[1-9]\d{0,3}$/.test(value.sourceId) || typeof value.date !== "string" || !isValidLogDate(value.date) || value.month !== value.date.slice(0, 7) ||
    (value.headingIndex !== null && (!Number.isInteger(value.headingIndex) || (value.headingIndex as number) < 0 || (value.headingIndex as number) > 100_000))) throw new RagSessionInputError("来源定位字段无效");
  const fileName = text(value.fileName, "来源文件名", 200);
  if (!/^\d{4}(?:-\d{2})?_学习日志\.md$/.test(fileName) || !value.date.startsWith(fileName.split("_")[0])) throw new RagSessionInputError("来源文件名或年月归属无效");
  return { sourceId: value.sourceId, date: value.date, month: value.month as string, fileName,
    heading: value.heading === null ? null : text(value.heading, "来源标题", 1000, true), headingIndex: value.headingIndex as number | null,
    chunkId: text(value.chunkId, "来源区块标识", 300), contentHash: text(value.contentHash, "来源内容标识", 128),
    ...(value.excerpt === undefined ? {} : { excerpt: text(value.excerpt, "来源片段", 12000, true) }) };
}
function messages(input: unknown): RagChatMessage[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 200 || input.length % 2) throw new RagSessionInputError("会话须包含成对的问题与回答，最多200条消息");
  let size = 0;
  const ids = new Set<string>();
  const result = input.map((item, index): RagChatMessage => {
    const value = object(item);
    fields(value, ["id", "role", "content", "citations", "status", "error", "groundingWarning"]);
    const id = text(value.id, "消息标识", 120);
    if (ids.has(id)) throw new RagSessionInputError("消息标识不能重复");
    ids.add(id);
    const role = index % 2 ? "assistant" : "user";
    if (value.role !== role) throw new RagSessionInputError("问题与回答必须交替排列");
    const status = value.status === undefined ? "complete" : value.status;
    if (!["complete", "stopped", "error"].includes(status as string) || (role === "user" && status !== "complete")) throw new RagSessionInputError("不能保存流式或无效状态的消息");
    const content = text(value.content, "消息正文", 120000, status !== "complete");
    const sources = value.citations === undefined ? [] : value.citations;
    if (!Array.isArray(sources) || sources.length > 30 || (role === "user" && sources.length)) throw new RagSessionInputError("回答来源数量无效");
    const citations = sources.map(citation);
    if (new Set(citations.map(source => source.sourceId)).size !== citations.length) throw new RagSessionInputError("回答来源标识不能重复");
    if (value.error !== undefined && status !== "error") throw new RagSessionInputError("只有失败消息可以保存错误说明");
    const message: RagChatMessage = { id, role, content, status: status as RagChatMessage["status"], citations,
      ...(value.error === undefined ? {} : { error: text(value.error, "错误说明", 2000, true) }),
      ...(value.groundingWarning === undefined ? {} : { groundingWarning: text(value.groundingWarning, "来源提示", 2000, true) }) };
    size += JSON.stringify(message).length;
    if (size > 2_000_000) throw new RagSessionInputError("单个问答会话超过2,000,000字符");
    return message;
  });
  return result;
}
function answerMode(input: unknown): RagAnswerMode {
  if (input !== "logs_only" && input !== "logs_and_general") throw new RagSessionInputError("回答范围无效");
  return input;
}
function title(input: unknown): string {
  const value = text(input, "会话标题", 240).replace(/\s+/g, " ").trim();
  if (Array.from(value).length > 60) throw new RagSessionInputError("标题不能超过60个字符");
  return value;
}
function timestamp(input: unknown): string {
  if (typeof input !== "string" || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString() !== input) throw new RagSessionInputError("会话时间无效");
  return input;
}
function decode(raw: string): SessionsFile {
  try {
    const data = object(JSON.parse(raw)); fields(data, ["schemaVersion", "sessions", "tombstones"]);
    if (data.schemaVersion !== 1 || !Array.isArray(data.sessions) || !Array.isArray(data.tombstones)) throw new Error();
    const seen = new Set<string>();
    const sessions = data.sessions.map(input => {
      const item = object(input); fields(item, ["id", "title", "titleSource", "createdAt", "updatedAt", "answerMode", "messages", "lastMutationId", "fingerprint"]);
      const id = uuid(item.id);
      if (seen.has(id) || id !== item.id || !["manual", "generated", "fallback"].includes(item.titleSource as string)) throw new Error();
      seen.add(id);
      const record: SessionRecord = { id, title: title(item.title), titleSource: item.titleSource as TitleSource,
        createdAt: timestamp(item.createdAt), updatedAt: timestamp(item.updatedAt), answerMode: answerMode(item.answerMode), messages: messages(item.messages),
        lastMutationId: uuid(item.lastMutationId), fingerprint: baseVersion(item.fingerprint) };
      if (record.createdAt > record.updatedAt || record.title !== item.title || record.lastMutationId !== item.lastMutationId || (item.messages as Array<Record<string, unknown>>).some(message => !Object.hasOwn(message, "status") || !Object.hasOwn(message, "citations"))) throw new Error();
      return record;
    });
    const tombstones = data.tombstones.map(input => {
      const item = object(input); fields(item, ["id", "mutationId", "fingerprint", "baseVersion", "deletedAt"]);
      const id = uuid(item.id); if (seen.has(id) || id !== item.id) throw new Error(); seen.add(id);
      return { id, mutationId: uuid(item.mutationId), fingerprint: baseVersion(item.fingerprint), baseVersion: baseVersion(item.baseVersion), deletedAt: timestamp(item.deletedAt) };
    });
    return { schemaVersion: 1, sessions, tombstones };
  } catch { throw new RagSessionStorageError(); }
}

async function directory(root: string) {
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment); const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RagSessionStorageError();
  }
}
async function fileExists(target: string): Promise<boolean> {
  try { const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new RagSessionStorageError(); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function ensureDirectory(root: string, name: string) {
  await directory(root); const target = path.join(root, name);
  try { await fs.mkdir(target, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await directory(target); return target;
}
export function getRagSessionsFilePath(): string { return path.join(getLogRoot(), "state", FILE_NAME); }
async function read(root: string): Promise<{ file: SessionsFile; raw: string | null }> {
  await directory(root); const state = path.join(root, "state");
  try { await directory(state); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file: { schemaVersion: 1, sessions: [], tombstones: [] }, raw: null }; throw error; }
  const target = path.join(state, FILE_NAME);
  if (!await fileExists(target)) return { file: { schemaVersion: 1, sessions: [], tombstones: [] }, raw: null };
  if ((await fs.stat(target)).size > 64 * 1024 * 1024) throw new RagSessionStorageError();
  const raw = await fs.readFile(target, "utf8"); return { file: decode(raw), raw };
}
async function write(root: string, file: SessionsFile, previous: string | null) {
  const state = await ensureDirectory(root, "state"), target = path.join(state, FILE_NAME);
  const raw = `${JSON.stringify(file, null, 2)}\n`;
  if (Buffer.byteLength(raw) > 64 * 1024 * 1024) throw new RagSessionStorageError();
  const temp = path.join(state, `${FILE_NAME}.${crypto.randomUUID()}.tmp`); let created = false;
  try {
    if (previous !== null) {
      const backups = await ensureDirectory(getBackupRoot(), "rag-sessions");
      const backup = path.join(backups, `${new Date().toISOString().replace(/[:.]/g, "-")}.${crypto.randomUUID()}.json`);
      const handle = await fs.open(backup, "wx", 0o600);
      try { await handle.writeFile(previous, "utf8"); await handle.sync(); } finally { await handle.close(); }
    }
    const handle = await fs.open(temp, "wx", 0o600); created = true;
    try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
    if ((await read(root)).raw !== previous) throw new RagSessionConflictError();
    await directory(state); await fileExists(target); await fileExists(temp); await fs.rename(temp, target);
  } finally {
    if (created) await directory(state).then(() => fileExists(temp)).then(exists => exists ? fs.unlink(temp) : undefined).catch(() => {});
  }
}
function queued<T>(task: (root: string) => Promise<T>): Promise<T> {
  const root = getLogRoot(), previous = queues.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => task(root)).catch(error => {
    if (error instanceof RagSessionInputError || error instanceof RagSessionConflictError || error instanceof RagSessionNotFoundError || error instanceof RagSessionStorageError) throw error;
    throw new RagSessionStorageError();
  });
  queues.set(root, next); void next.finally(() => { if (queues.get(root) === next) queues.delete(root); }).catch(() => {}); return next;
}
function summary(record: SessionRecord): RagSessionSummary {
  return { id: record.id, title: record.title, titleSource: record.titleSource, createdAt: record.createdAt, updatedAt: record.updatedAt,
    messageCount: record.messages.length, lastQuestion: [...record.messages].reverse().find(message => message.role === "user")?.content || "", version: version(record) };
}
function session(record: SessionRecord): RagSession { return { ...summary(record), answerMode: record.answerMode, messages: record.messages }; }
function fingerprint(operation: string, input: unknown): string { return hash(JSON.stringify({ operation, input })); }
function retry(record: SessionRecord, mutationId: string, digest: string): boolean {
  if (record.lastMutationId !== mutationId) return false;
  if (record.fingerprint !== digest) throw new RagSessionConflictError();
  return true;
}
function find(file: SessionsFile, id: string): SessionRecord {
  const record = file.sessions.find(item => item.id === id);
  if (!record) throw new RagSessionNotFoundError(); return record;
}
export function fallbackRagSessionTitle(question: string): string {
  const clean = question.replace(/[`*_#>\[\]]/g, "").replace(/\s+/g, " ").trim();
  const phrase = clean.split(/[。！？!?；;\n]/, 1)[0]?.trim() || "新会话", chars = Array.from(phrase);
  return chars.length <= 20 ? phrase : `${chars.slice(0, 19).join("")}…`;
}
export function listRagSessions(query = ""): Promise<RagSessionSummary[]> {
  const needle = text(query, "搜索词", 1000, true).trim().toLocaleLowerCase();
  return queued(async root => (await read(root)).file.sessions.filter(record => !needle || record.title.toLocaleLowerCase().includes(needle) || record.messages.some(message => message.role === "user" && message.content.toLocaleLowerCase().includes(needle)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).map(summary));
}
export function getRagSession(id: string): Promise<RagSession> { const target = uuid(id); return queued(async root => session(find((await read(root)).file, target))); }
export function createRagSession(input: CreateRagSessionInput): Promise<RagSession> {
  const value = object(input); fields(value, ["id", "mutationId", "baseVersion", "answerMode", "messages"]);
  const id = uuid(value.id), mutationId = uuid(value.mutationId), mode = answerMode(value.answerMode), content = messages(value.messages);
  if (value.baseVersion !== null) throw new RagSessionInputError("创建会话必须提供baseVersion:null");
  const digest = fingerprint("create", { id, answerMode: mode, messages: content });
  return queued(async root => {
    const { file, raw } = await read(root), existing = file.sessions.find(item => item.id === id);
    if (existing) { if (retry(existing, mutationId, digest)) return session(existing); throw new RagSessionConflictError(); }
    if (file.tombstones.some(item => item.id === id)) throw new RagSessionConflictError();
    const now = new Date().toISOString(), record: SessionRecord = { id, title: fallbackRagSessionTitle(content[0].content), titleSource: "fallback", createdAt: now, updatedAt: now, answerMode: mode, messages: content, lastMutationId: mutationId, fingerprint: digest };
    file.sessions.push(record); await write(root, file, raw); return session(record);
  });
}
export function updateRagSession(id: string, input: SaveRagSessionInput): Promise<RagSession> {
  const target = uuid(id), value = object(input); fields(value, ["mutationId", "baseVersion", "answerMode", "messages"]);
  const mutationId = uuid(value.mutationId), base = baseVersion(value.baseVersion), mode = answerMode(value.answerMode), content = messages(value.messages);
  const digest = fingerprint("update", { answerMode: mode, messages: content });
  return queued(async root => {
    const { file, raw } = await read(root), record = find(file, target);
    if (retry(record, mutationId, digest)) return session(record);
    if (version(record) !== base) throw new RagSessionConflictError();
    Object.assign(record, { answerMode: mode, messages: content, updatedAt: new Date().toISOString(), lastMutationId: mutationId, fingerprint: digest });
    await write(root, file, raw); return session(record);
  });
}
export function renameRagSession(id: string, input: RenameRagSessionInput): Promise<RagSession> {
  const target = uuid(id), value = object(input); fields(value, ["mutationId", "baseVersion", "title"]);
  const mutationId = uuid(value.mutationId), base = baseVersion(value.baseVersion), name = title(value.title), digest = fingerprint("rename", { title: name });
  return queued(async root => {
    const { file, raw } = await read(root), record = find(file, target);
    if (retry(record, mutationId, digest)) return session(record);
    if (version(record) !== base) throw new RagSessionConflictError();
    Object.assign(record, { title: name, titleSource: "manual", updatedAt: new Date().toISOString(), lastMutationId: mutationId, fingerprint: digest });
    await write(root, file, raw); return session(record);
  });
}
export function deleteRagSession(id: string, input: DeleteRagSessionInput): Promise<void> {
  const target = uuid(id), value = object(input); fields(value, ["mutationId", "baseVersion"]);
  const mutationId = uuid(value.mutationId), base = baseVersion(value.baseVersion), digest = fingerprint("delete", { baseVersion: base });
  return queued(async root => {
    const { file, raw } = await read(root), deleted = file.tombstones.find(item => item.id === target);
    if (deleted) { if (deleted.mutationId === mutationId && deleted.fingerprint === digest && deleted.baseVersion === base) return; throw new RagSessionConflictError(); }
    const record = find(file, target);
    if (record.lastMutationId === mutationId || version(record) !== base) throw new RagSessionConflictError();
    file.sessions = file.sessions.filter(item => item.id !== target);
    file.tombstones.push({ id: target, mutationId, fingerprint: digest, baseVersion: base, deletedAt: new Date().toISOString() });
    await write(root, file, raw);
  });
}
/** The route checks titleSource before spending a model request; check again after it finishes. */
export function applyGeneratedRagSessionTitle(id: string, expectedVersion: string, generatedTitle: string): Promise<RagSession> {
  const target = uuid(id), base = baseVersion(expectedVersion), name = title(generatedTitle);
  return queued(async root => {
    const { file, raw } = await read(root), record = find(file, target);
    if (record.titleSource !== "fallback") return session(record);
    if (version(record) !== base) throw new RagSessionConflictError();
    Object.assign(record, { title: name, titleSource: "generated", updatedAt: new Date().toISOString(), lastMutationId: crypto.randomUUID(), fingerprint: fingerprint("generated-title", { title: name }) });
    await write(root, file, raw); return session(record);
  });
}

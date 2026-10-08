import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { getLogRoot } from "./config.ts";

export const WRITING_PROMPTS = ["generation", "highlighting", "extraction"] as const;
export type WritingPrompt = typeof WRITING_PROMPTS[number];
export const MAX_WRITING_PROMPT_BYTES = 64 * 1024;
export type PromptIssueReason = "missing" | "empty" | "too_large" | "invalid_utf8" | "unsafe_path" | "unreadable" | "invalid_root";
export interface PromptIssue { reason: PromptIssueReason; message: string }
export interface PromptReadiness { configured: boolean; issue?: PromptIssue }

const explanations: Record<PromptIssueReason, string> = {
  missing: "文件不存在", empty: "内容为空", too_large: "文件超过 64 KiB",
  invalid_utf8: "文件不是有效 UTF-8 文本", unsafe_path: "路径包含链接或不是普通文件",
  unreadable: "无法读取文件", invalid_root: "学习记录目录未正确配置"
};

export class WritingPromptError extends Error {
  readonly code = "AI_TEMPLATE_INVALID";
  readonly kind: WritingPrompt;
  readonly reason: PromptIssueReason;
  constructor(kind: WritingPrompt, reason: PromptIssueReason) {
    super(`模板 prompts/${kind}.md：${explanations[reason]}`);
    this.kind = kind;
    this.reason = reason;
    this.name = "WritingPromptError";
  }
}

async function checkPath(file: string, kind: WritingPrompt): Promise<void> {
  let current = path.parse(file).root;
  const segments = file.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new WritingPromptError(kind, "unsafe_path");
    }
  }
}

/** Read afresh so editing a template takes effect without restart. No private Skill fallback. */
export async function readWritingPrompt(kind: WritingPrompt): Promise<string> {
  if (!WRITING_PROMPTS.includes(kind)) throw new Error("未知的写作模板类型");
  let root: string;
  try { root = getLogRoot(); } catch { throw new WritingPromptError(kind, "invalid_root"); }
  const file = path.join(root, "prompts", `${kind}.md`);
  try {
    await checkPath(file, kind);
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat({ bigint: true });
      await checkPath(file, kind);
      const current = await fs.lstat(file, { bigint: true });
      if (!opened.isFile() || opened.ino !== current.ino || (process.platform !== "win32" && opened.dev !== current.dev)) {
        throw new WritingPromptError(kind, "unsafe_path");
      }
      if (opened.size > BigInt(MAX_WRITING_PROMPT_BYTES)) throw new WritingPromptError(kind, "too_large");
      // A bounded read also handles a file growing after stat without unbounded allocation.
      const bytes = Buffer.alloc(MAX_WRITING_PROMPT_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_WRITING_PROMPT_BYTES) throw new WritingPromptError(kind, "too_large");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)).trim(); }
      catch { throw new WritingPromptError(kind, "invalid_utf8"); }
      if (!text) throw new WritingPromptError(kind, "empty");
      return text;
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof WritingPromptError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    throw new WritingPromptError(kind, code === "ENOENT" ? "missing" : code === "ELOOP" ? "unsafe_path" : "unreadable");
  }
}

/** Per-capability template diagnostics; this neither calls a model nor implies network readiness. */
export async function inspectWritingPrompts(): Promise<Record<WritingPrompt, PromptReadiness>> {
  const result = {} as Record<WritingPrompt, PromptReadiness>;
  for (const kind of WRITING_PROMPTS) {
    try { await readWritingPrompt(kind); result[kind] = { configured: true }; }
    catch (error) {
      const issue = error as WritingPromptError;
      result[kind] = { configured: false, issue: { reason: issue.reason, message: issue.message } };
    }
  }
  return result;
}

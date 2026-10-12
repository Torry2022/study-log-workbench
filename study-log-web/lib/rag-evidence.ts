import { readStudyLogRange, retrieveStudyLogContexts, type RangePage, type RetrievedContextsResult } from "./mcp-client.ts";
import type { McpConfig } from "./mcp-config.ts";
import type { RagRetrievalPlan } from "./rag-retrieval-plan.ts";
import type { RagRetrievedContext } from "./rag-types.ts";
import { createHash } from "node:crypto";
import { findRootAtxHeadings } from "./day-content.ts";

type DaySection = Pick<RagRetrievedContext, "heading" | "headingIndex" | "contentHash">;
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
// Only complete, uncompressed day reads can prove that no extra body is being discarded.
function completeDaySections(item: RagRetrievedContext): DaySection[] | null {
  if (item.truncated || item.chunkId !== `${item.date}:range:0` || hash(item.content) !== item.contentHash) return null;
  const days = findRootAtxHeadings(item.content, 2), headings = findRootAtxHeadings(item.content, 3);
  if (days.length !== 1 || days[0].start !== 0 || days[0].text !== item.date) return null;
  const sections: DaySection[] = [];
  const preamble = item.content.slice(days[0].end, headings[0]?.start ?? item.content.length).trim();
  if (preamble) sections.push({ heading: null, headingIndex: null, contentHash: hash(preamble) });
  for (const [headingIndex, heading] of headings.entries()) {
    const body = item.content.slice(heading.end, headings[headingIndex + 1]?.start ?? item.content.length).trim();
    if (!body) return null; // Empty headings still carry information.
    const title = heading.text.replace(/!\[([^\]]*)]\([^)]+\)/g, "$1").replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1").replace(/<\/?[^>]+>/g, "").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim().replace(/^\d+\.\s*/, "").trim();
    sections.push({ heading: title, headingIndex, contentHash: hash(body) });
  }
  return sections.length ? sections : null;
}
const sameSection = (left: DaySection, right: DaySection) => left.heading === right.heading && left.headingIndex === right.headingIndex && left.contentHash === right.contentHash;

export interface ScopeCoverage { dateFrom?: string; dateTo?: string; totalDays: number | null; readDates: string[]; status: "complete" | "partial" | "empty" | "failed" | "search" }
export class EvidenceRun {
  contexts: RagRetrievedContext[] = [];
  coverage: ScopeCoverage[] = [];
  readonly compactedSources = new Set<string>();
  readonly compactionOriginals = new Map<string, string>();
  calls = 0;
  limited = false;
  private retainedChars = 0;
  private completeDays = new Map<string, DaySection[]>();
  private dayVersions = new Map<string, string>();
  sourceChanged = false;
  stopReason?: "tool_budget" | "repeated_query" | "no_new_evidence" | "step_limit" | "decision_output_limit" | "tool_failure" | "evidence_limit" | "sufficient_evidence" | "no_more_leads" | "source_changed";
  readonly requests = new Set<string>();
  readonly signal: AbortSignal;
  constructor(signal: AbortSignal) { this.signal = signal; }
  availableReadDates(): string[] {
    return [...new Set(this.contexts.map(item => item.date))].filter(date => {
      if ([...this.requests].some(request => { const [name, args] = JSON.parse(request); return name === "read_log_range" && args.dateFrom <= date && args.dateTo >= date; })) return false;
      const items = this.contexts.filter(item => item.date === date);
      // A server completeness claim only applies while every supplied body remains intact.
      return !items.every(item => item.dayFullyProvided === true && !item.truncated && hash(item.content) === item.contentHash);
    });
  }
  take(name: string, args: unknown): boolean {
    this.signal.throwIfAborted();
    if (this.sourceChanged) return false;
    const key = JSON.stringify([name, args]);
    if (this.calls >= 8 || this.requests.has(key)) { this.limited = true; this.stopReason = this.calls >= 8 ? "tool_budget" : "repeated_query"; return false; }
    this.calls++; this.requests.add(key); return true;
  }
  add(items: RagRetrievedContext[]): number {
    if (this.sourceChanged) return 0;
    let added = 0;
    for (const item of items) {
      const sameDay = this.contexts.filter(old => old.date === item.date && old.fileName === item.fileName);
      const dayKey = JSON.stringify([item.fileName, item.date]);
      const version = item.dayContentHash || (new RegExp(`^${item.date}:range:\\d+$`).test(item.chunkId) ? item.contentHash : undefined);
      // Never silently combine changed day snapshots within a run.
      if (version && this.dayVersions.has(dayKey) && this.dayVersions.get(dayKey) !== version ||
        sameDay.some(old => old.chunkId === item.chunkId && old.contentHash !== item.contentHash && (!version || old.dayContentHash !== version))) {
        this.sourceChanged = true; this.limited = true; this.stopReason = "source_changed"; return added;
      }
      if (version) this.dayVersions.set(dayKey, version);
      if (this.contexts.some(old => old.fileName === item.fileName && old.chunkId === item.chunkId && old.contentHash === item.contentHash)) continue;
      const sections = completeDaySections(item);
      if (sections && sections.every(section => sameDay.some(old => !old.truncated && sameSection(section, old)))) continue;
      if (!item.truncated && sameDay.some(old => old.chunkId === `${item.date}:range:0` && !old.truncated) &&
        this.completeDays.get(dayKey)?.some(section => sameSection(section, item))) continue;
      if (this.contexts.length >= 160 || this.retainedChars + item.content.length > 120000) { this.limited = true; this.stopReason = "evidence_limit"; continue; }
      this.retainedChars += item.content.length;
      this.contexts.push({ ...item, sourceId: `S${this.contexts.length + 1}` }); added++;
      if (sections) this.completeDays.set(dayKey, sections);
    }
    return added;
  }
  report(): string {
    return JSON.stringify({ scopes: this.coverage, limited: this.limited, sourceChanged: this.sourceChanged, stopReason: this.stopReason,
      retainedDates: [...new Set(this.contexts.map(item => item.date))], truncatedSources: this.contexts.filter(item => item.truncated).map(item => item.sourceId), compactedSources: [...this.compactedSources],
      instruction: "search 仅表示相关性检索，不证明全库穷尽。complete 表示该日期范围已分页读完，不表示最终材料包含全部细节。compactedSources 为从原文选出的摘录，[…]表示省略，不能据此推断未读的日期或原日志缺少内容；压缩失败或后续容量不足另看 limited 和 truncatedSources。不因早期搜索 partial 就否认后续读取。判断缺口须核对当前证据，当前已提供的原文或规则不能再说未提供。partial/failed 或 limited 时必须说明材料范围，不得声称完整总结或不存在相关记录。sufficient_evidence/no_more_leads 仅为取证模型的停止判断，不是程序证明材料完整。天数仅表示日志日块数量，不代表学习次数或掌握程度。" });
  }
}
type Readers = {
  search: (query: string, plan: RagRetrievalPlan, signal: AbortSignal, config: McpConfig) => Promise<RetrievedContextsResult>;
  read: (range: { dateFrom: string; dateTo: string; cursor?: string }, signal: AbortSignal, config: McpConfig) => Promise<RangePage>;
};
export async function collectRagEvidence(query: string, plan: RagRetrievalPlan, run: EvidenceRun, config: McpConfig,
  readers: Readers = { search: retrieveStudyLogContexts, read: readStudyLogRange }): Promise<void> {
  const scopes = plan.ranges || [{ dateFrom: plan.dateFrom, dateTo: plan.dateTo }];
  for (const range of scopes) {
    const coverage: ScopeCoverage = { ...range, totalDays: null, readDates: [], status: "search" };
    run.coverage.push(coverage);
    if (!plan.matchMode && plan.strategy !== "relevance" && range.dateFrom && range.dateTo) {
      let cursor: string | undefined, revision: string | undefined;
      coverage.status = "partial";
      do {
        const args = { dateFrom: range.dateFrom, dateTo: range.dateTo, ...(cursor ? { cursor } : {}) };
        if (!run.take("read_log_range", args)) break;
        try {
          const page = await readers.read(args, run.signal, config);
          run.signal.throwIfAborted();
          if (revision && revision !== page.coverage.revision) throw new Error("Source changed");
          revision = page.coverage.revision; coverage.totalDays = page.coverage.totalDays;
          run.add(page.contexts);
          coverage.readDates = [...new Set([...coverage.readDates, ...page.coverage.completedDates])];
          cursor = page.coverage.nextCursor || undefined;
          if (!cursor) coverage.status = page.coverage.totalDays === 0 ? "empty" : run.sourceChanged || run.stopReason === "evidence_limit" || coverage.readDates.length !== coverage.totalDays ? "partial" : "complete";
        } catch (error) { run.signal.throwIfAborted(); coverage.status = "failed"; break; }
      // A prior search truncation is a reason to read on, not to stop pagination.
      } while (cursor && run.stopReason !== "evidence_limit");
    } else {
      const scoped = { ...plan, ...range, ranges: undefined };
      if (!run.take("retrieve_contexts", [query, scoped])) { coverage.status = "partial"; continue; }
      const result = await readers.search(query, scoped, run.signal, config);
      run.signal.throwIfAborted();
      run.add(result.contexts);
      coverage.readDates = [...new Set(result.contexts.map(item => item.date))];
      if (result.context.truncated || result.contexts.some(item => item.truncated)) { coverage.status = "partial"; run.limited = true; }
    }
  }
}

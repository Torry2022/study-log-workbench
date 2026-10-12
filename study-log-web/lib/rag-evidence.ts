import { readStudyLogRange, retrieveStudyLogContexts, type RangePage, type RetrievedContextsResult } from "./mcp-client.ts";
import type { McpConfig } from "./mcp-config.ts";
import type { RagRetrievalPlan } from "./rag-retrieval-plan.ts";
import type { RagRetrievedContext } from "./rag-types.ts";
import { RAG_MAX_SOURCES } from "./rag-types.ts";
import { createHash } from "node:crypto";
import { findRootAtxHeadings } from "./day-content.ts";
import { isValidLogDate } from "./study-date.ts";

type DaySection = Pick<RagRetrievedContext, "heading" | "headingIndex" | "contentHash">;
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const MAX_TOOL_CALLS = 8;
// Each validated MCP read returns at most 30,000 characters. Retain the full
// admitted read budget before selecting excerpts for the model's input window.
const MAX_RETAINED_CHARS = MAX_TOOL_CALLS * 30000;
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
  stopReason?: "tool_budget" | "repeated_query" | "no_new_evidence" | "step_limit" | "decision_output_limit" | "tool_failure" | "invalid_read_date" | "evidence_limit" | "sufficient_evidence" | "no_more_leads" | "source_changed";
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
    if (this.calls >= MAX_TOOL_CALLS || this.requests.has(key)) { this.limited = true; this.stopReason = this.calls >= MAX_TOOL_CALLS ? "tool_budget" : "repeated_query"; return false; }
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
      const duplicate = this.contexts.find(old => old.fileName === item.fileName && old.chunkId === item.chunkId && old.contentHash === item.contentHash);
      if (duplicate) {
        // The original identity may still be present while its model-visible body
        // was reduced. Restore only the exact, same-version original we retained.
        if (this.compactedSources.has(duplicate.sourceId) && this.compactionOriginals.get(duplicate.sourceId) === item.content && duplicate.content !== item.content) {
          duplicate.content = item.content; duplicate.truncated = item.truncated;
          this.compactedSources.delete(duplicate.sourceId); added++;
        }
        continue;
      }
      const sections = completeDaySections(item);
      if (sections && sections.every(section => sameDay.some(old => !old.truncated && sameSection(section, old) && hash(old.content) === old.contentHash))) continue;
      if (!item.truncated && sameDay.some(old => old.chunkId === `${item.date}:range:0` && !old.truncated && hash(old.content) === old.contentHash) &&
        this.completeDays.get(dayKey)?.some(section => sameSection(section, item))) continue;
      if (this.contexts.length >= RAG_MAX_SOURCES || this.retainedChars + item.content.length > MAX_RETAINED_CHARS) { this.limited = true; this.stopReason = "evidence_limit"; continue; }
      this.retainedChars += item.content.length;
      this.contexts.push({ ...item, sourceId: `S${this.contexts.length + 1}` }); added++;
      if (sections) this.completeDays.set(dayKey, sections);
    }
    return added;
  }
  private reportedScopes() {
    return this.coverage.map(scope => ({ ...scope,
      lastReadDate: scope.readDates.filter(date => isValidLogDate(date) && (!scope.dateFrom || date >= scope.dateFrom) && (!scope.dateTo || date <= scope.dateTo)).sort().at(-1) || null
    }));
  }
  answerReport(): string {
    const status = { complete: "已完整读取该范围的日志日块", partial: "读取不完整", empty: "已确认该范围没有日志", failed: "读取失败", search: "仅搜索了相关内容，未穷尽范围" };
    const reason = { tool_budget: "工具调用次数达到上限", repeated_query: "重复查询已停止", no_new_evidence: "未取得新的证据", step_limit: "补查轮数达到上限", decision_output_limit: "模型未完整结束补查决策", tool_failure: "补查工具失败", invalid_read_date: "模型选择的日期不在允许读取的集合中", evidence_limit: "保留材料达到容量上限", sufficient_evidence: "取证模型判断已有足够依据", no_more_leads: "取证模型判断没有更多线索", source_changed: "读取期间原文改变" };
    const scopes = this.reportedScopes().map(scope =>
      `${scope.dateFrom || "起始日期未指定"}至${scope.dateTo || "结束日期未指定"}：${status[scope.status]}；日志日块总数${scope.totalDays === null ? "未确定" : scope.totalDays}；已读日期${scope.readDates.join("、") || "无"}；实际最后读取日期${scope.lastReadDate || "无"}。`);
    return [...scopes,
      `取证停止原因：${this.stopReason ? reason[this.stopReason] : "未提供"}。`,
      `最终保留材料的日期：${[...new Set(this.contexts.map(item => item.date))].join("、") || "无"}。`,
      `正文有截断的来源：${this.contexts.filter(item => item.truncated).map(item => `[${item.sourceId}]`).join("、") || "无"}。`,
      `已改为原文摘录的来源：${[...this.compactedSources].map(id => `[${id}]`).join("、") || "无"}。`,
      ...(this.limited ? ["本轮材料不完整或取证受限，只能回答已有原文支持的部分。"] : []),
      ...(this.sourceChanged ? ["读取期间原文已改变，不能混用版本。"] : []),
      "搜索命中不能证明全库没有其他记录。范围读完不等于最终材料包含全部细节；摘录中的省略不能证明原日志没有相关内容。早期局部搜索不否定后续读取，当前已提供的依据不能再说未提供。读取不完整、失败或材料受限时，应说明实际材料范围，不得声称完整总结或没有相关记录。取证模型决定结束不代表程序证明完整；日志日块数量不代表学习次数或掌握程度。仅在影响答案时，用自然语言说明材料缺口，不复述内部检查过程。"
    ].join("\n");
  }
  report(): string {
    return JSON.stringify({ scopes: this.reportedScopes(), limited: this.limited, sourceChanged: this.sourceChanged, stopReason: this.stopReason,
      retainedDates: [...new Set(this.contexts.map(item => item.date))], truncatedSources: this.contexts.filter(item => item.truncated).map(item => item.sourceId), compactedSources: [...this.compactedSources],
      instruction: "search 仅表示相关性检索，不证明全库穷尽。complete 表示该日期范围已分页读完，不表示最终材料包含全部细节。compactedSources 为从原文选出的摘录，[…]表示省略，不能据此推断未读的日期或原日志缺少内容；压缩失败或后续容量不足另看 limited 和 truncatedSources。不因早期搜索 partial 就否认后续读取。判断缺口须核对当前证据，当前已提供的原文或规则不能再说未提供。partial/failed 或 limited 时必须说明材料范围，不得声称完整总结或不存在相关记录。sufficient_evidence/no_more_leads 仅为取证模型的停止判断，不是程序证明材料完整。天数仅表示日志日块数量，不代表学习次数或掌握程度。" });
  }
}
type Readers = {
  search: (query: string, plan: RagRetrievalPlan, signal: AbortSignal, config: McpConfig) => Promise<RetrievedContextsResult>;
  read: (range: { dateFrom: string; dateTo: string; cursor?: string }, signal: AbortSignal, config: McpConfig) => Promise<RangePage>;
};
export async function collectRagEvidence(query: string, plan: RagRetrievalPlan, run: EvidenceRun, config: McpConfig,
  readers: Readers = { search: retrieveStudyLogContexts, read: readStudyLogRange }): Promise<string[]> {
  const addedSourceIds: string[] = [];
  const register = (items: RagRetrievedContext[]) => {
    const before = new Map(run.contexts.map(item => [item.sourceId, item.content]));
    run.add(items);
    addedSourceIds.push(...run.contexts.filter(item => !before.has(item.sourceId) || before.get(item.sourceId) !== item.content).map(item => item.sourceId));
  };
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
          if (revision && revision !== page.coverage.revision) {
            run.sourceChanged = true; run.limited = true; run.stopReason = "source_changed";
            throw new Error("Source changed");
          }
          revision = page.coverage.revision; coverage.totalDays = page.coverage.totalDays;
          register(page.contexts);
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
      register(result.contexts);
      coverage.readDates = [...new Set(result.contexts.map(item => item.date))];
      if (result.context.truncated || result.contexts.some(item => item.truncated)) { coverage.status = "partial"; run.limited = true; }
    }
  }
  return addedSourceIds;
}

import { readStudyLogRange, retrieveStudyLogContexts, type RangePage, type RetrievedContextsResult } from "./mcp-client.ts";
import type { McpConfig } from "./mcp-config.ts";
import type { RagRetrievalPlan } from "./rag-retrieval-plan.ts";
import type { RagRetrievedContext } from "./rag-types.ts";

export interface ScopeCoverage { dateFrom?: string; dateTo?: string; totalDays: number | null; readDates: string[]; status: "complete" | "partial" | "empty" | "failed" | "search" }
export class EvidenceRun {
  contexts: RagRetrievedContext[] = [];
  coverage: ScopeCoverage[] = [];
  calls = 0;
  limited = false;
  stopReason?: "tool_budget" | "repeated_query" | "no_new_evidence" | "step_limit" | "tool_failure" | "evidence_limit";
  readonly requests = new Set<string>();
  readonly signal: AbortSignal;
  constructor(signal: AbortSignal) { this.signal = signal; }
  take(name: string, args: unknown): boolean {
    this.signal.throwIfAborted();
    const key = JSON.stringify([name, args]);
    if (this.calls >= 8 || this.requests.has(key)) { this.limited = true; this.stopReason = this.calls >= 8 ? "tool_budget" : "repeated_query"; return false; }
    this.calls++; this.requests.add(key); return true;
  }
  add(items: RagRetrievedContext[]): number {
    let added = 0;
    for (const item of items) {
      const sameDay = this.contexts.filter(old => old.date === item.date && old.fileName === item.fileName);
      // Never silently combine changed day snapshots within a run.
      if (sameDay.some(old => old.chunkId === item.chunkId && old.contentHash !== item.contentHash)) { this.limited = true; continue; }
      if (this.contexts.some(old => old.fileName === item.fileName && old.chunkId === item.chunkId && old.contentHash === item.contentHash)) continue;
      if (this.contexts.length >= 160 || this.contexts.reduce((sum, old) => sum + old.content.length, 0) + item.content.length > 120000) { this.limited = true; this.stopReason = "evidence_limit"; continue; }
      this.contexts.push({ ...item, sourceId: `S${this.contexts.length + 1}` }); added++;
    }
    return added;
  }
  report(): string {
    return JSON.stringify({ scopes: this.coverage, limited: this.limited, stopReason: this.stopReason,
      retainedDates: [...new Set(this.contexts.map(item => item.date))], truncatedSources: this.contexts.filter(item => item.truncated).map(item => item.sourceId),
      instruction: "search 仅表示相关性检索，不证明全库穷尽。partial/failed 或 limited 时必须说明材料范围，不得声称完整总结或不存在相关记录。天数仅表示日志日块数量，不代表学习次数或掌握程度。" });
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
          if (!cursor) coverage.status = page.coverage.totalDays === 0 ? "empty" : run.limited ? "partial" : "complete";
        } catch (error) { run.signal.throwIfAborted(); coverage.status = "failed"; break; }
      } while (cursor && !run.limited);
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

import { randomUUID } from "node:crypto";
import { AiChatError } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { McpConfig } from "./mcp-config.ts";
import { McpRetrievalError } from "./mcp-client.ts";
import { buildRagMessages, normalizeRagAnswer, createRagAnswerOutput, NO_LOG_EVIDENCE } from "./rag-answer.ts";
import { contextualizeRagQuestion, planRagRetrievalWithFallback, type RagContextualizedQuestion } from "./rag-planning.ts";
import { streamRagAnswer } from "./rag-stream.ts";
import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types.ts";
import { RAG_MAX_SOURCES } from "./rag-types.ts";

import { EvidenceRun, collectRagEvidence } from "./rag-evidence.ts";
import { agentEnabled, createAgentModel, supplementEvidence } from "./rag-agent.ts";
import { compactEvidence } from "./rag-evidence-summary.ts";
import { judgeEvidence, jevConfiguration, isBoundedJevInput } from "./rag-jev.ts";
import { planRagRetrieval } from "./rag-retrieval-plan.ts";
import { extractRangeStatusClaims, rangeStatusVerificationEnabled, verifyRangeStatusClaims } from "./rag-status-verifier.ts";

export interface RagQueryInput { question: string; history: RagHistoryMessage[]; mode: RagAnswerMode }
export interface RagQueryConfig { chat: ChatConfig; lightChat: ChatConfig; mcp: McpConfig }
export function createRagQueryStream(input: RagQueryInput, config: RagQueryConfig, requestSignal: AbortSignal): ReadableStream<Uint8Array> {
  const cancellation = new AbortController(), deadline = new AbortController();
  const external = AbortSignal.any([requestSignal, cancellation.signal]);
  const signal = AbortSignal.any([external, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), 120000);
  let ended = false;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => { if (!ended && !external.aborted) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const close = () => { if (!ended) { ended = true; controller.close(); } };
      const started = performance.now();
      const diagnostics: RagDiagnostics = { traceId: randomUUID(), status: "completed", answerMode: input.mode, questionChars: input.question.length, historyMessages: input.history.length, contextualized: false, contextualizationFallback: false, retrievalMode: null, retrievalStrategy: "relevance", retrievalPlanner: "rules", sourceCount: 0, timings: { contextualizationMs: 0, planningMs: 0, retrievalMs: 0, firstTokenMs: null, generationMs: 0, totalMs: 0 } };
      diagnostics.usage = [];
      Object.assign(diagnostics.timings, { compactionMs: 0, judgeMs: 0, agentMs: 0, statusVerificationMs: 0 });
      const measure = async <T>(key: "retrievalMs" | "compactionMs" | "judgeMs" | "agentMs" | "statusVerificationMs", operation: () => Promise<T>): Promise<T> => {
        const phaseStart = performance.now();
        try { return await operation(); }
        finally { diagnostics.timings[key] = (diagnostics.timings[key] || 0) + Math.round(performance.now() - phaseStart); }
      };
      config = { ...config, chat: { ...config.chat, onUsage: usage => diagnostics.usage!.push({ model: config.chat.model, ...usage }) }, lightChat: { ...config.lightChat, onUsage: usage => diagnostics.usage!.push({ model: config.lightChat.model, ...usage }) } };
      let stage: NonNullable<RagDiagnostics["failureStage"]> = "contextualizing", stageStart = performance.now();
      const elapsed = () => Math.round(performance.now() - stageStart);
      try {
        signal.throwIfAborted();
        let query = input.question;
        let contextualized: RagContextualizedQuestion | undefined;
        const original = planRagRetrieval(input.question);
        if (original.invalidDate) {
          diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          send("done", { answer: "问题中的日期似乎有误，请检查月份和天数后再提问。", citations: [], diagnostics });
          close(); return;
        }
        const referenceNumber = input.question.match(/(?:刚才|上(?:一|个)(?:次|回答)?|第)\s*(?:的)?\s*(?:第)?([一二三四五六七八九十]|\d+)\s*(?:条|个)?来源/);
        const referenceIndex = referenceNumber ? (/^\d+$/.test(referenceNumber[1]) ? Number(referenceNumber[1]) : "一二三四五六七八九十".indexOf(referenceNumber[1]) + 1) - 1 : -1;
        const referenced = [...input.history].reverse().find(message => message.role === "assistant")?.sourceRefs?.[referenceIndex];
        if (referenceNumber && !referenced) {
          // A missing source pointer is not permission to search for a different source.
          diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          send("done", { answer: "无法确定你指的是哪条来源。请打开对应的日志，或补充日期和小节标题后再提问。", citations: [], diagnostics });
          close(); return;
        }
        const originalRanges = original.ranges || [{ dateFrom: original.dateFrom, dateTo: original.dateTo }];
        if (referenced && !originalRanges.some(range => (!range.dateFrom || referenced.date >= range.dateFrom) && (!range.dateTo || referenced.date <= range.dateTo))) {
          diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          send("done", { answer: "这条历史来源不在你指定的日期范围内。请确认是查看这条来源，还是只查该日期范围内的记录。", citations: [], diagnostics });
          close(); return;
        }
        if (input.history.length && !referenced) {
          send("status", { stage, message: "正在理解问题" });
          try {
            contextualized = await contextualizeRagQuestion(input.question, input.history, signal, config.lightChat);
            query = contextualized.query; diagnostics.contextualized = query !== input.question || contextualized.scopeSource !== null;
          } catch (error) {
            const priorScope = input.history.some(item => item.role === "user" && planRagRetrieval(item.content).dateFrom);
            if (signal.aborted || error instanceof AiChatError && error.code === "RAG_CONTEXT_UNCERTAIN" || priorScope && !original.dateFrom && !original.matchMode && !original.eventDates) throw error;
            diagnostics.contextualizationFallback = true;
          }
          diagnostics.timings.contextualizationMs = elapsed();
        }
        signal.throwIfAborted(); stage = "planning"; stageStart = performance.now();
        send("status", { stage: "contextualizing", message: "正在规划检索" });
        // A new topic is planned from the current question, not dates inserted into rewritten prose.
        const planningQuestion = contextualized ? input.question : query;
        const planned = contextualized && contextualized.scopeSource !== null
          ? { plan: contextualized.plan, planner: "rules" as const }
          : !referenced && /总结|回顾|比较|对比|阶段|期间|那几天|之前|之后/.test(planningQuestion)
            ? await planRagRetrievalWithFallback(planningQuestion, signal, new Date(), config.lightChat)
            : { plan: contextualized?.plan || planRagRetrieval(query), planner: "rules" as const };
        // Rewriting may resolve pronouns but cannot erase original explicit constraints.
        if (original.dateFrom || original.matchMode || original.eventDates) planned.plan = original;
        if (referenced) planned.plan = { strategy: "timeline_summary", dateFrom: referenced.date, dateTo: referenced.date };
        diagnostics.timings.planningMs = elapsed(); diagnostics.retrievalPlanner = planned.planner; diagnostics.retrievalStrategy = planned.plan.strategy;
        const comparisonScopes = planned.plan.strategy === "comparison" && planned.plan.ranges?.length && planned.plan.ranges.length > 1
          ? planned.plan.ranges
          : [];
        signal.throwIfAborted(); stage = "retrieving"; stageStart = performance.now();
        send("status", { stage, message: "正在检索日志" });
        const run = new EvidenceRun(signal);
        let directAnswer: string | undefined;
        await measure("retrievalMs", () => collectRagEvidence(query, planned.plan, run, config.mcp));
        if (run.sourceChanged) throw new McpRetrievalError("MCP_SOURCE_CHANGED", "读取期间日志发生了修改，请重新提问以读取最新内容");
        if (referenced && run.contexts.some(item => item.fileName !== referenced.fileName)) { run.contexts = []; run.limited = true; }
        if (run.coverage.length && run.coverage.every(scope => scope.status === "failed")) throw new McpRetrievalError("MCP_RANGE_FAILED", "无法读取所选日期的日志，请检查检索服务版本或重试");
        const boundedJevInput = isBoundedJevInput(input.question, run.contexts);
        await measure("compactionMs", () => compactEvidence(run, input.question, config.lightChat, config.chat, input.history, input.mode, comparisonScopes));
        // Successful enumeration covers the requested scope, including confirmed empty periods.
        // Check after compaction: a failed summary can still leave material missing.
        const scopeFullyRead = !run.limited && run.coverage.length > 0 && run.coverage.every(scope => scope.status === "complete" || scope.status === "empty");
        const completeDays = run.coverage.filter(scope => scope.status === "complete").reduce((sum, scope) => sum + scope.readDates.length, 0);
        const verifyRangeStatus = scopeFullyRead && rangeStatusVerificationEnabled(planned.plan.strategy, completeDays);
        // Search coverage is not proof that the question is answered. Let the same
        // bounded tool loop choose finish or follow a lead, independent of wording.
        if (agentEnabled() && !scopeFullyRead && !planned.plan.matchMode) {
          diagnostics.agent = { enabled: true };
          const jev = jevConfiguration();
          if (process.env.RAG_JEV_ENABLED === "true" && jev) {
            if (!boundedJevInput) diagnostics.agent.judgeSkipped = "outside_short_evidence_scope";
            else {
              try {
                const judged = await measure("judgeMs", () => judgeEvidence(input.question, run.contexts, signal, jev.apiKey, fetch, jev.provider));
                diagnostics.agent.judgment = judged.judgment;
                diagnostics.agent.judgeUsage = judged.usage;
              } catch { signal.throwIfAborted(); diagnostics.agent.judgeUnavailable = true; }
            }
          }
          if (diagnostics.agent.judgment?.support !== "supported" || diagnostics.agent.judgment?.conflict !== "absent") {
            const result = await measure("agentMs", () => supplementEvidence(input.question, planned.plan, run, config.mcp, createAgentModel(config.chat), message => send("status", { stage: "retrieving", message }), config.lightChat, { mode: input.mode, history: input.history, chat: config.chat }));
            diagnostics.agent.usage = result.usage; directAnswer = result.answer;
            diagnostics.agent.answeredDirectly = directAnswer !== undefined;
          }
          diagnostics.agent.stopReason = run.stopReason;
        }
        await measure("compactionMs", () => compactEvidence(run, input.question, config.lightChat, config.chat, input.history, input.mode, comparisonScopes));
        diagnostics.coverage = run.coverage; diagnostics.toolCalls = run.calls;
        if (run.sourceChanged) throw new McpRetrievalError("MCP_SOURCE_CHANGED", "读取期间日志发生了修改，请重新提问以读取最新内容");
        const retrieved = { contexts: run.contexts };
        diagnostics.retrievalMode = "bounded_evidence";
        const citations: RagCitation[] = retrieved.contexts.map(({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }) => ({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }));
        diagnostics.sourceCount = citations.length;
        // Candidate retrieval hits are internal; publish only final, used sources.
        if (!citations.length && input.mode === "logs_only") {
          diagnostics.status = "no_evidence"; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          send("done", { answer: run.limited || run.coverage.some(scope => scope.status === "partial" || scope.status === "failed") ? "本次未能完整读取相关记录，目前没有足够依据回答。可以缩小日期范围后重试。" : NO_LOG_EVIDENCE, citations: [], diagnostics }); close(); return;
        }
        signal.throwIfAborted(); stage = "answering"; stageStart = performance.now();
        send("status", { stage, message: "正在生成回答" });
        const output = createRagAnswerOutput(input.mode, delta => {
          if (diagnostics.timings.firstTokenMs === null) diagnostics.timings.firstTokenMs = Math.round(performance.now() - started);
          send("delta", { text: delta });
        });
        try {
          if (directAnswer !== undefined) output.push(directAnswer);
          else {
            const coverage = run.answerReport() + (referenced ? `\n用户指向历史来源：${referenced.date} ${referenced.heading || ""}。已重新读取当前原文；历史摘录和编号不可视为当前事实。` : "");
            const messages = buildRagMessages(input.question, input.history, retrieved.contexts, input.mode, coverage, verifyRangeStatus, comparisonScopes);
            if (!verifyRangeStatus) await streamRagAnswer(config.chat, messages, delta => output.push(delta), { signal });
            else {
              let draft = "";
              await streamRagAnswer(config.chat, messages, delta => { draft += delta; }, { signal });
              const claimCount = extractRangeStatusClaims(draft).length;
              if (!claimCount) {
                diagnostics.rangeStatusVerification = { enabled: true, claimCount: 0, removedCount: 0 };
                output.push(draft);
              } else try {
                send("status", { stage: "answering", message: "正在核对范围末状态" });
                const verified = await measure("statusVerificationMs", () => verifyRangeStatusClaims(draft, messages, config.chat, signal));
                diagnostics.rangeStatusVerification = { enabled: true, claimCount: verified.verdicts.length,
                  removedCount: verified.verdicts.filter(verdict => verdict.verdict !== "supported").length };
                output.push(verified.answer);
              } catch {
                signal.throwIfAborted();
                diagnostics.rangeStatusVerification = { enabled: true, claimCount, removedCount: 0, failed: true };
                output.push(`${draft.trim()}\n\n> 范围末状态核对未完成，请结合来源确认“仍待解决”部分。`);
              }
            }
          }
        } finally { output.flush(); }
        diagnostics.timings.generationMs = elapsed(); diagnostics.timings.totalMs = Math.round(performance.now() - started);
        if (output.noEvidence) diagnostics.status = "no_evidence";
        const normalized = normalizeRagAnswer(output.answer, output.noEvidence ? [] : citations, input.mode);
        if (normalized.citations.length > RAG_MAX_SOURCES) throw new AiChatError("RAG_CITATION_LIMIT", "回答来源超过本轮材料限制；本次回答未保存");
        send("sources", { citations: normalized.citations });
        send("done", { ...normalized, diagnostics });
      } catch (error) {
        if (!external.aborted) {
          diagnostics.status = "error"; diagnostics.failureStage = stage; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          const timing = { contextualizing: "contextualizationMs", planning: "planningMs", retrieving: "retrievalMs", answering: "generationMs" } as const;
          // Retrieval subphases record their own success/failure duration in finally.
          if (stage !== "retrieving") diagnostics.timings[timing[stage]] = elapsed();
          const known = error instanceof AiChatError || error instanceof McpRetrievalError;
          send("error", { message: deadline.signal.aborted ? "本次问答用时过长，请缩小范围后重试" : known ? error.message : "问答请求失败，请稍后重试", code: deadline.signal.aborted ? "RAG_TIMEOUT" : known ? error.code : "RAG_QUERY_FAILED", diagnostics });
        }
      } finally { clearTimeout(timer); close(); }
    },
    cancel() { clearTimeout(timer); ended = true; cancellation.abort(); }
  });
}

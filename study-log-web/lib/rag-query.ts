import { randomUUID } from "node:crypto";
import { AiChatError } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { McpConfig } from "./mcp-config.ts";
import { McpRetrievalError } from "./mcp-client.ts";
import { buildRagMessages, normalizeRagAnswer, createRagAnswerOutput, NO_LOG_EVIDENCE } from "./rag-answer.ts";
import { contextualizeRagQuestion, planRagRetrievalWithFallback } from "./rag-planning.ts";
import { streamRagAnswer } from "./rag-stream.ts";
import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types.ts";

import { EvidenceRun, collectRagEvidence } from "./rag-evidence.ts";
import { agentEnabled, createAgentModel, supplementEvidence } from "./rag-agent.ts";
import { compactEvidence } from "./rag-evidence-summary.ts";
import { judgeEvidence, jevConfiguration, isBoundedJevInput } from "./rag-jev.ts";
import { planRagRetrieval } from "./rag-retrieval-plan.ts";

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
      config = { ...config, chat: { ...config.chat, onUsage: usage => diagnostics.usage!.push({ model: config.chat.model, ...usage }) }, lightChat: { ...config.lightChat, onUsage: usage => diagnostics.usage!.push({ model: config.lightChat.model, ...usage }) } };
      let stage: NonNullable<RagDiagnostics["failureStage"]> = "contextualizing", stageStart = performance.now();
      const elapsed = () => Math.round(performance.now() - stageStart);
      try {
        signal.throwIfAborted();
        let query = input.question;
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
        if (input.history.length && !referenced) {
          send("status", { stage, message: "正在理解问题" });
          try { query = await contextualizeRagQuestion(input.question, input.history, signal, config.lightChat); diagnostics.contextualized = query !== input.question; }
          catch (error) { if (signal.aborted) throw error; diagnostics.contextualizationFallback = true; }
          diagnostics.timings.contextualizationMs = elapsed();
        }
        signal.throwIfAborted(); stage = "planning"; stageStart = performance.now();
        send("status", { stage: "contextualizing", message: "正在规划检索" });
        const planned = !referenced && /总结|回顾|比较|对比|阶段|期间|那几天|之前|之后/.test(query)
          ? await planRagRetrievalWithFallback(query, signal, new Date(), config.lightChat)
          : { plan: planRagRetrieval(query), planner: "rules" as const };
        // Rewriting may resolve pronouns but cannot erase original explicit constraints.
        if (original.dateFrom || original.matchMode || original.eventDates) planned.plan = original;
        if (referenced) planned.plan = { strategy: "timeline_summary", dateFrom: referenced.date, dateTo: referenced.date };
        diagnostics.timings.planningMs = elapsed(); diagnostics.retrievalPlanner = planned.planner; diagnostics.retrievalStrategy = planned.plan.strategy;
        signal.throwIfAborted(); stage = "retrieving"; stageStart = performance.now();
        send("status", { stage, message: "正在检索日志" });
        const run = new EvidenceRun(signal);
        await collectRagEvidence(query, planned.plan, run, config.mcp);
        if (referenced && run.contexts.some(item => item.fileName !== referenced.fileName)) { run.contexts = []; run.limited = true; }
        if (run.coverage.length && run.coverage.every(scope => scope.status === "failed")) throw new McpRetrievalError("MCP_RANGE_FAILED", "无法读取所选日期的日志，请检查检索服务版本或重试");
        const boundedJevInput = isBoundedJevInput(input.question, run.contexts);
        await compactEvidence(run, input.question, config.lightChat);
        if (agentEnabled() && !planned.plan.matchMode && (planned.plan.strategy === "comparison" || !run.contexts.length || /为什么|如何|关联|矛盾|变化/.test(input.question))) {
          diagnostics.agent = { enabled: true };
          const jev = jevConfiguration();
          if (process.env.RAG_JEV_ENABLED === "true" && jev) {
            if (!boundedJevInput) diagnostics.agent.judgeSkipped = "outside_short_evidence_scope";
            else {
              try {
                const judged = await judgeEvidence(input.question, run.contexts, signal, jev.apiKey, fetch, jev.provider);
                diagnostics.agent.judgment = judged.judgment;
                diagnostics.agent.judgeUsage = judged.usage;
              } catch { signal.throwIfAborted(); diagnostics.agent.judgeUnavailable = true; }
            }
          }
          if (diagnostics.agent.judgment?.support !== "supported" || diagnostics.agent.judgment?.conflict !== "absent") {
            diagnostics.agent.usage = await supplementEvidence(input.question, planned.plan, run, config.mcp, createAgentModel(config.lightChat), message => send("status", { stage: "retrieving", message }), config.lightChat);
          }
          diagnostics.agent.stopReason = run.stopReason;
        }
        await compactEvidence(run, input.question, config.lightChat);
        diagnostics.coverage = run.coverage; diagnostics.toolCalls = run.calls;
        const retrieved = { contexts: run.contexts };
        diagnostics.timings.retrievalMs = elapsed(); diagnostics.retrievalMode = "bounded_evidence";
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
          await streamRagAnswer(config.chat, buildRagMessages(input.question, input.history, retrieved.contexts, input.mode, run.report() + (referenced ? `\n用户指向历史来源：${referenced.date} ${referenced.heading || ""}。已重新读取当前原文；历史摘录和编号不可视为当前事实。` : "")), delta => output.push(delta), { signal });
        } finally { output.flush(); }
        diagnostics.timings.generationMs = elapsed(); diagnostics.timings.totalMs = Math.round(performance.now() - started);
        if (output.noEvidence) diagnostics.status = "no_evidence";
        const normalized = normalizeRagAnswer(output.answer, output.noEvidence ? [] : citations, input.mode);
        if (normalized.citations.length > 30) throw new AiChatError("RAG_CITATION_LIMIT", "回答引用较多，请缩小日期范围后重试；本次回答未保存");
        send("sources", { citations: normalized.citations });
        send("done", { ...normalized, diagnostics });
      } catch (error) {
        if (!external.aborted) {
          diagnostics.status = "error"; diagnostics.failureStage = stage; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          const timing = { contextualizing: "contextualizationMs", planning: "planningMs", retrieving: "retrievalMs", answering: "generationMs" } as const;
          diagnostics.timings[timing[stage]] = elapsed();
          const known = error instanceof AiChatError || error instanceof McpRetrievalError;
          send("error", { message: deadline.signal.aborted ? "本次问答用时过长，请缩小范围后重试" : known ? error.message : "问答请求失败，请稍后重试", code: deadline.signal.aborted ? "RAG_TIMEOUT" : known ? error.code : "RAG_QUERY_FAILED", diagnostics });
        }
      } finally { clearTimeout(timer); close(); }
    },
    cancel() { clearTimeout(timer); ended = true; cancellation.abort(); }
  });
}

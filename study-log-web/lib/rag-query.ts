import { randomUUID } from "node:crypto";
import { AiChatError } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { McpConfig } from "./mcp-config.ts";
import { McpRetrievalError, retrieveStudyLogContexts } from "./mcp-client.ts";
import { buildRagMessages, normalizeRagAnswer } from "./rag-answer.ts";
import { contextualizeRagQuestion, planRagRetrievalWithFallback } from "./rag-planning.ts";
import { streamRagAnswer } from "./rag-stream.ts";
import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types.ts";

export interface RagQueryInput { question: string; history: RagHistoryMessage[]; mode: RagAnswerMode }
export interface RagQueryConfig { chat: ChatConfig; lightChat: ChatConfig; mcp: McpConfig }
export function createRagQueryStream(input: RagQueryInput, config: RagQueryConfig, requestSignal: AbortSignal): ReadableStream<Uint8Array> {
  const cancellation = new AbortController(), signal = AbortSignal.any([requestSignal, cancellation.signal]);
  let ended = false;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => { if (!ended && !signal.aborted) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      const close = () => { if (!ended) { ended = true; controller.close(); } };
      const started = performance.now();
      const diagnostics: RagDiagnostics = { traceId: randomUUID(), status: "completed", answerMode: input.mode, questionChars: input.question.length, historyMessages: input.history.length, contextualized: false, contextualizationFallback: false, retrievalMode: null, retrievalStrategy: "relevance", retrievalPlanner: "rules", sourceCount: 0, timings: { contextualizationMs: 0, planningMs: 0, retrievalMs: 0, firstTokenMs: null, generationMs: 0, totalMs: 0 } };
      let stage: NonNullable<RagDiagnostics["failureStage"]> = "contextualizing", stageStart = performance.now();
      const elapsed = () => Math.round(performance.now() - stageStart);
      try {
        signal.throwIfAborted();
        let query = input.question;
        if (input.history.length) {
          send("status", { stage, message: "正在理解问题" });
          try { query = await contextualizeRagQuestion(input.question, input.history, signal, config.lightChat); diagnostics.contextualized = query !== input.question; }
          catch (error) { if (signal.aborted) throw error; diagnostics.contextualizationFallback = true; }
          diagnostics.timings.contextualizationMs = elapsed();
        }
        signal.throwIfAborted(); stage = "planning"; stageStart = performance.now();
        send("status", { stage: "contextualizing", message: "正在规划检索" });
        const planned = await planRagRetrievalWithFallback(query, signal, new Date(), config.lightChat);
        diagnostics.timings.planningMs = elapsed(); diagnostics.retrievalPlanner = planned.planner; diagnostics.retrievalStrategy = planned.plan.strategy;
        signal.throwIfAborted(); stage = "retrieving"; stageStart = performance.now();
        send("status", { stage, message: "正在检索日志" });
        const retrieved = await retrieveStudyLogContexts(query, planned.plan, signal, config.mcp);
        diagnostics.timings.retrievalMs = elapsed(); diagnostics.retrievalMode = retrieved.retrieval?.mode || null;
        const citations: RagCitation[] = retrieved.contexts.map(({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }) => ({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }));
        diagnostics.sourceCount = citations.length; send("sources", { citations });
        if (!citations.length && input.mode === "logs_only") {
          diagnostics.status = "no_evidence"; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("done", { answer: "当前日志中没有找到足够依据来回答这个问题。", citations: [], diagnostics }); close(); return;
        }
        signal.throwIfAborted(); stage = "answering"; stageStart = performance.now();
        send("status", { stage, message: "正在生成回答" });
        const answer = await streamRagAnswer(config.chat, buildRagMessages(input.question, input.history, retrieved.contexts, input.mode), delta => {
          if (diagnostics.timings.firstTokenMs === null) diagnostics.timings.firstTokenMs = Math.round(performance.now() - started);
          send("delta", { text: delta });
        }, { signal });
        diagnostics.timings.generationMs = elapsed(); diagnostics.timings.totalMs = Math.round(performance.now() - started);
        send("done", { ...normalizeRagAnswer(answer, citations, input.mode), diagnostics });
      } catch (error) {
        if (!signal.aborted) {
          diagnostics.status = "error"; diagnostics.failureStage = stage; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          const timing = { contextualizing: "contextualizationMs", planning: "planningMs", retrieving: "retrievalMs", answering: "generationMs" } as const;
          diagnostics.timings[timing[stage]] = elapsed();
          const known = error instanceof AiChatError || error instanceof McpRetrievalError;
          send("error", { message: known ? error.message : "问答请求失败，请稍后重试", code: known ? error.code : "RAG_QUERY_FAILED", diagnostics });
        }
      } finally { close(); }
    },
    cancel() { ended = true; cancellation.abort(); }
  });
}

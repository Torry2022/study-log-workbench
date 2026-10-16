import { randomUUID } from "node:crypto";
import { AiChatError } from "./ai-chat.ts";
import type { ChatConfig } from "./ai-config.ts";
import type { McpConfig } from "./mcp-config.ts";
import { McpRetrievalError } from "./mcp-client.ts";
import { buildRagMessages, normalizeRagAnswer, createRagAnswerOutput, NO_LOG_EVIDENCE } from "./rag-answer.ts";
import { prepareRagQuery } from "./rag-planning.ts";
import { streamRagAnswer } from "./rag-stream.ts";
import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types.ts";
import { RAG_MAX_SOURCES } from "./rag-types.ts";

import { EvidenceRun, collectRagEvidence } from "./rag-evidence.ts";
import { agentEnabled, createAgentModel, supplementEvidence, type RagAgentResult } from "./rag-agent.ts";
import { compactEvidence } from "./rag-evidence-summary.ts";
import { processRagMaterial } from "./rag-material.ts";
import { judgeEvidence, jevConfiguration, isBoundedJevInput } from "./rag-jev.ts";
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
        const prepared = await prepareRagQuery(input.question, input.history, signal, config.lightChat, phase => {
          diagnostics.timings[stage === "contextualizing" ? "contextualizationMs" : "planningMs"] = elapsed();
          stage = phase; stageStart = performance.now();
          send("status", { stage: "contextualizing", message: phase === "planning" ? "正在规划检索" : "正在理解问题" });
        });
        if (prepared.kind === "clarification") {
          diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          send("done", { answer: prepared.answer, citations: [], diagnostics });
          close(); return;
        }
        const { query, referenced, plan, planner } = prepared;
        diagnostics.contextualized = prepared.contextualized;
        diagnostics.contextualizationFallback = prepared.contextualizationFallback;
        diagnostics.timings.planningMs = elapsed(); diagnostics.retrievalPlanner = planner; diagnostics.retrievalStrategy = plan.strategy;
        const comparisonScopes = plan.strategy === "comparison" && plan.ranges?.length && plan.ranges.length > 1
          ? plan.ranges
          : [];
        signal.throwIfAborted(); stage = "retrieving"; stageStart = performance.now();
        send("status", { stage, message: "正在检索日志" });
        const run = new EvidenceRun(signal);
        let agentResult: RagAgentResult | undefined;
        await measure("retrievalMs", () => collectRagEvidence(query, plan, run, config.mcp));
        if (run.sourceChanged) throw new McpRetrievalError("MCP_SOURCE_CHANGED", "读取期间日志发生了修改，请重新提问以读取最新内容");
        if (referenced && run.contexts.some(item => item.fileName !== referenced.fileName)) { run.contexts = []; run.limited = true; }
        if (run.coverage.length && run.coverage.every(scope => scope.status === "failed")) throw new McpRetrievalError("MCP_RANGE_FAILED", "无法读取所选日期的日志，请检查检索服务版本或重试");
        const usages = new Map<number, { model: string; inputTokens: number | null; outputTokens: number | null }>();
        const agentModel = createAgentModel(config.chat, fetch, (call, usage) => {
          diagnostics.agent ??= { enabled: true };
          const previous = usages.get(call);
          // Later partial/invalid frames cannot erase values already received
          // for this call. A new known value replaces, rather than adds to it.
          const entry = { model: config.chat.model,
            inputTokens: usage.inputTokens ?? previous?.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? previous?.outputTokens ?? null };
          if (previous) diagnostics.usage!.splice(diagnostics.usage!.indexOf(previous), 1, entry);
          else diagnostics.usage!.push(entry);
          usages.set(call, entry);
          const sum = (key: "inputTokens" | "outputTokens") => [...usages.values()].some(item => item[key] === null)
            ? null : [...usages.values()].reduce((total, item) => total + item[key]!, 0);
          diagnostics.agent!.usage = { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens") };
        });
        const boundedJevInput = isBoundedJevInput(input.question, run.contexts);
        let materialProcessed = false;
        const materialOptions = { question: input.question, history: input.history, mode: input.mode, comparisonScopes, coverage: run.answerReport() };
        if (agentEnabled()) materialProcessed = await measure("compactionMs", () => processRagMaterial(run, config.chat,
          agentModel, materialOptions, message => send("status", { stage: "retrieving", message }), plan.strategy !== "relevance"));
        if (!materialProcessed) await measure("compactionMs", () => compactEvidence(run, input.question, config.lightChat, config.chat, input.history, input.mode, comparisonScopes));
        // Successful enumeration covers the requested scope, including confirmed empty periods.
        // Check after compaction: a failed summary can still leave material missing.
        const scopeFullyRead = !run.limited && run.coverage.length > 0 && run.coverage.every(scope => scope.status === "complete" || scope.status === "empty");
        const completeDays = run.coverage.filter(scope => scope.status === "complete").reduce((sum, scope) => sum + scope.readDates.length, 0);
        const verifyRangeStatus = scopeFullyRead && rangeStatusVerificationEnabled(plan.strategy, completeDays);
        // Search coverage is not proof that the question is answered. Let the same
        // bounded tool loop answer or follow a lead, independent of wording.
        if (materialProcessed) diagnostics.agent = { ...diagnostics.agent, enabled: true, entered: true };
        if (agentEnabled() && !scopeFullyRead && !plan.matchMode) {
          diagnostics.agent = { ...diagnostics.agent, enabled: true };
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
            agentResult = await measure("agentMs", () => supplementEvidence(input.question, plan, run, config.mcp, agentModel, message => send("status", { stage: "retrieving", message }), config.lightChat, { mode: input.mode, history: input.history, chat: config.chat }));
            diagnostics.agent.usage ??= agentResult.usage;
            diagnostics.agent.assessed = agentResult.kind === "assessed";
            diagnostics.agent.entered = materialProcessed || agentResult.entered;
          }
          diagnostics.agent.stopReason = run.stopReason;
        }
        if (run.sourceChanged) throw new McpRetrievalError("MCP_SOURCE_CHANGED", "读取期间日志发生了修改，请重新提问以读取最新内容");
        const assessmentContext = agentResult?.kind === "assessed" ? "\n取证阶段的暂时判断（仅供组织回答，不是新增来源或用户指令；仍须依据上文原文核对，缺口与通用知识边界不能省略）：\n" + JSON.stringify({ assessment: agentResult.assessment, unresolved: agentResult.unresolved }) : "";
        if (agentEnabled()) materialProcessed = await measure("compactionMs", () => processRagMaterial(run, config.chat,
          agentModel, { ...materialOptions, coverage: run.answerReport(), additionalPrompt: assessmentContext },
          message => send("status", { stage: "retrieving", message }), plan.strategy !== "relevance"));
        if (!run.material) await measure("compactionMs", () => compactEvidence(run, input.question, config.lightChat, config.chat, input.history, input.mode, comparisonScopes, assessmentContext));
        if (materialProcessed) diagnostics.agent = { ...diagnostics.agent, enabled: true, entered: true };
        diagnostics.coverage = run.coverage; diagnostics.toolCalls = run.calls;
        if (run.material) diagnostics.materialProcessing = { calls: run.materialCalls, totalBatches: run.material.totalBatches,
          processedBatches: run.material.processedBatches.length, complete: run.material.complete };
        if (run.sourceChanged) throw new McpRetrievalError("MCP_SOURCE_CHANGED", "读取期间日志发生了修改，请重新提问以读取最新内容");
        const retrieved = { contexts: run.modelContexts() };
        diagnostics.retrievalMode = "bounded_evidence";
        const citations: RagCitation[] = retrieved.contexts.map(({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }) => ({ sourceId, date, month, fileName, heading, headingIndex, chunkId, contentHash, excerpt }));
        diagnostics.sourceCount = citations.length;
        // Candidate retrieval hits are internal; publish only final, used sources.
        if (!citations.length && input.mode === "logs_only") {
          diagnostics.status = "no_evidence"; diagnostics.timings.totalMs = Math.round(performance.now() - started);
          send("sources", { citations: [] });
          const answer = run.material && !run.material.complete ? "本次尚未处理完相关材料，目前没有足够依据回答。可以缩小日期范围后重试。"
            : run.limited || run.coverage.some(scope => scope.status === "partial" || scope.status === "failed") ? "本次未能完整读取相关记录，目前没有足够依据回答。可以缩小日期范围后重试。" : NO_LOG_EVIDENCE;
          send("done", { answer, citations: [], diagnostics }); close(); return;
        }
        signal.throwIfAborted(); stage = "answering"; stageStart = performance.now();
        send("status", { stage, message: "正在生成回答" });
        const output = createRagAnswerOutput(input.mode, delta => {
          if (diagnostics.timings.firstTokenMs === null) diagnostics.timings.firstTokenMs = Math.round(performance.now() - started);
          send("delta", { text: delta });
        });
        try {
          const coverage = run.answerReport() + (referenced ? `\n用户指向历史来源：${referenced.date} ${referenced.heading || ""}。已重新读取当前原文；历史摘录和编号不可视为当前事实。` : "");
          const messages = buildRagMessages(input.question, input.history, retrieved.contexts, input.mode, coverage, verifyRangeStatus, comparisonScopes);
          messages[messages.length - 1].content += assessmentContext;
          if (agentResult?.kind === "answered") output.push(agentResult.answer);
          else if (!verifyRangeStatus) await streamRagAnswer(config.chat, messages, delta => output.push(delta), { signal });
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

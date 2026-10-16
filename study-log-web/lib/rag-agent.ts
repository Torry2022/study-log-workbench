import { streamText, isStepCount, jsonSchema, tool, type LanguageModel, type LanguageModelUsage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ChatConfig } from "./ai-config.ts";
import { chatThinkingParameters } from "./ai-config.ts";
import type { McpConfig } from "./mcp-config.ts";
import { AiChatError, readChatUsage } from "./ai-chat.ts";
import { EvidenceRun, collectRagEvidence } from "./rag-evidence.ts";
import type { RagRetrievalPlan } from "./rag-retrieval-plan.ts";
import { isValidLogDate } from "./study-date.ts";
import { compactEvidence } from "./rag-evidence-summary.ts";
import { processRagMaterial } from "./rag-material.ts";
import { buildRagMessages, mapRagCitationLabels, NO_LOG_EVIDENCE } from "./rag-answer.ts";
import type { RagAnswerMode, RagHistoryMessage } from "./rag-types.ts";

/** Tool use is an explicitly verified model capability, independent of provider identity. */
export function agentEnabled(env = process.env): boolean {
  return (env.RAG_AGENT_ENABLED === undefined || env.RAG_AGENT_ENABLED === "true") && env.RAG_AGENT_TOOL_CALLING_VERIFIED === "true";
}
export function createAgentModel(config: ChatConfig, transport: typeof fetch = fetch,
  onUsage?: (call: number, usage: { inputTokens: number | null; outputTokens: number | null }) => void): LanguageModel {
  const thinking = chatThinkingParameters(config);
  let call = 0;
  return createOpenAICompatible({ name: "study-log", baseURL: new URL(config.baseUrl).origin,
    apiKey: config.apiKey,
    fetch: async (_url, init) => {
      const callId = ++call;
      onUsage?.(callId, { inputTokens: null, outputTokens: null });
      const response = await transport(config.baseUrl, { ...init, redirect: "error",
        ...(config.thinkingMode ? { body: JSON.stringify({ ...JSON.parse(String(init?.body)), ...thinking }) } : {}) });
      if (!onUsage || !response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) return response;
      // The provider adapter emits SDK usage only when its stream flushes. Observe
      // usage frames as they arrive so a later error or abort cannot erase them.
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      const signal = init?.signal;
      let aborted: (() => void) | undefined;
      const detach = () => { if (aborted) signal?.removeEventListener("abort", aborted); };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          aborted = () => { void reader.cancel().catch(() => {}); controller.error(signal?.reason); };
          if (signal?.aborted) aborted();
          else signal?.addEventListener("abort", aborted, { once: true });
        },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { detach(); controller.close(); reader.releaseLock(); return; }
            buffer += decoder.decode(chunk.value, { stream: true });
            let boundary: number, failed = false;
            while ((boundary = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, boundary).trimEnd(); buffer = buffer.slice(boundary + 1);
              if (!line.startsWith("data:")) continue;
              let payload;
              try {
                payload = JSON.parse(line.slice(5));
              } catch { /* SDK retains responsibility for malformed response errors. */ }
              if (payload?.usage) onUsage(callId, readChatUsage(payload.usage));
              failed ||= !!payload?.error || Array.isArray(payload?.choices) && payload.choices.some((choice: { finish_reason?: string } | null) => choice?.finish_reason === "content_filter");
            }
            controller.enqueue(chunk.value);
            // Let the SDK classify the received terminal frame, without draining
            // a failed provider just to wait for a later usage or [DONE] frame.
            if (failed) { detach(); void reader.cancel().catch(() => {}); controller.close(); }
          } catch (error) { detach(); await reader.cancel().catch(() => {}); controller.error(error); }
        },
        async cancel() { detach(); await reader.cancel().catch(() => {}); }
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  }).chatModel(config.model);
}

function requiresAgentToolChoice(config?: ChatConfig) {
  if (config?.thinkingMode !== "disabled" || config.model !== "deepseek-flash") return false;
  try {
    const endpoint = new URL(config.baseUrl);
    return endpoint.protocol === "https:" && endpoint.hostname === "api.deepseek.com";
  } catch { return false; }
}

export type RagAgentResult = (
  { kind: "answered"; answer: string } | { kind: "assessed"; assessment: string; unresolved: EvidenceAssessment["unresolved"] } | { kind: "needs_answer"; assessment?: never }
) & { entered: boolean; usage?: LanguageModelUsage; stopReason: NonNullable<EvidenceRun["stopReason"]> };

type EvidenceAssessment = {
  assessment: string;
  next: "finish" | "read";
  evidence: Array<{ point: string; sourceId: string; quote: string }>;
  unresolved: Array<{ point: string; sourceId: string | null }>;
};
type EvidenceAssessmentInput = Omit<EvidenceAssessment, "next">;
type EvidenceReadRequest = Omit<EvidenceAssessmentInput, "unresolved"> & {
  unresolved: Array<{ point: string; sourceId: string }>;
};
type EvidenceRequest = {
  name: "read"; gaps: EvidenceAssessment["unresolved"]; attemptedDates: string[]; addedSourceIds: string[];
} | {
  name: "search"; query: string; missingPoint: string; addedSourceIds: string[];
};

export async function supplementEvidence(question: string, plan: RagRetrievalPlan, run: EvidenceRun, mcp: McpConfig,
  model: LanguageModel, onStatus: (message: string) => void, summaryConfig?: ChatConfig,
  answerContext: { mode: RagAnswerMode; history: RagHistoryMessage[]; chat?: ChatConfig } = { mode: "logs_only", history: [] }): Promise<RagAgentResult> {
  run.signal.throwIfAborted();
  if (run.calls >= 8) { run.limited = true; run.stopReason ||= "tool_budget"; return { kind: "needs_answer", entered: false, stopReason: run.stopReason }; }
  let entered = run.materialCalls > 0;
  let noProgress = false, steps = 0;
  let currentPhase: "entry" | "evidence" = "entry";
  let stepUsedEvidenceTool = false, stepAddedEvidence = false;
  const stepReadDates = new Set<string>();
  let acceptedAssessment: Pick<EvidenceAssessment, "assessment" | "unresolved"> | undefined;
  let stepAssessment: Pick<EvidenceAssessment, "assessment" | "unresolved"> | undefined, stepAssessmentCount = 0;
  let stepAssessmentTool: "read_more" | "assess" | undefined;
  let directReply: string | undefined, stepReply: string | undefined, stepReplyCount = 0;
  let completionFailure: AiChatError | undefined;
  let previousEvidenceRequests: EvidenceRequest[] = [], stepEvidenceRequests: EvidenceRequest[] = [];
  const availableReadDates = () => run.availableReadDates();
  const readCandidates = () => {
    const dates = new Set(availableReadDates());
    return run.contexts.filter(item => dates.has(item.date)).map(({ sourceId, date, heading }) => ({ sourceId, date, heading }));
  };
  const trackEvidence = (addedSourceIds: string[]) => {
    entered = true;
    stepUsedEvidenceTool = true;
    stepAddedEvidence ||= addedSourceIds.length > 0;
    noProgress ||= run.sourceChanged || ["tool_budget", "repeated_query", "evidence_limit"].includes(run.stopReason || "");
  };
  const readEvidence = async (date: string) => {
    if (stepReadDates.has(date)) return [];
    if (!isValidLogDate(date) || !availableReadDates().includes(date)) {
      noProgress = true; run.limited = true; run.stopReason ||= "invalid_read_date";
      onStatus("补充读取未完成，正在根据已读记录回答");
      return [];
    }
    stepReadDates.add(date);
    entered = true;
    onStatus("正在读取相关日志的上下文");
    const addedSourceIds = await collectRagEvidence(question, { strategy: "timeline_summary", dateFrom: date, dateTo: date }, run, mcp);
    trackEvidence(addedSourceIds);
    return addedSourceIds;
  };
  const executeAssessment = async ({ assessment, evidence, unresolved }: EvidenceAssessmentInput,
    next: EvidenceAssessment["next"], requiredPhase: "entry" | "evidence", toolName: "read_more" | "assess") => {
    const invalid = () => { noProgress = true; return new AiChatError("AGENT_ANSWER_INVALID", "材料判断的来源或提交格式未通过检查，请重试"); };
    if (currentPhase !== requiredPhase || ++stepAssessmentCount > 1) throw invalid();
    const reads = new Set<string>();
    const supported = new Set<string>();
    for (const claim of evidence) {
      const source = run.resolveModelSource(claim.sourceId);
      if (!source) throw invalid();
      const matches = source.content.includes(claim.quote) || claim.quote === source.heading || claim.quote === source.date ||
        (source.heading != null && claim.quote === `小节：${source.heading}`) || claim.quote === `日志日期：${source.date}`;
      if (!matches) throw invalid();
      supported.add(source.sourceId);
    }
    // An invalid quotation cannot be used as the justification for a read. A
    // genuine missing-evidence decision may omit evidence entirely.
    if (evidence.length && !supported.size) throw invalid();
    for (const gap of unresolved) if (gap.sourceId !== null) {
      const source = run.resolveModelSource(gap.sourceId);
      if (!source) throw invalid();
      if (availableReadDates().includes(source.date)) reads.add(source.date);
    }
    if (next === "read" && !unresolved.length) throw invalid();
    if (next === "read" && !reads.size) run.stopReason ||= "no_new_evidence";
    if (next === "read" && reads.size) {
      const request: EvidenceRequest = { name: "read", gaps: unresolved.map(gap => ({ ...gap })), attemptedDates: [], addedSourceIds: [] };
      stepEvidenceRequests.push(request);
      for (const date of reads) {
        if (noProgress) break;
        request.attemptedDates.push(date);
        request.addedSourceIds.push(...await readEvidence(date));
      }
      return { accepted: false, reason: "read_before_assessment", readDates: [...reads] };
    }
    if (!supported.size && answerContext.mode === "logs_only" && !assessment.startsWith(NO_LOG_EVIDENCE)) throw invalid();
    let citationsValid = true;
    const mapped = mapRagCitationLabels(assessment, sourceId => {
      const source = run.resolveModelSource(sourceId);
      if (!source) citationsValid = false;
      return `[${source?.sourceId || sourceId}]`;
    });
    if (!citationsValid) throw invalid();
    stepAssessment = { assessment: mapped.trim(), unresolved: unresolved.map(gap => ({ ...gap, sourceId: gap.sourceId === null ? null : run.resolveModelSource(gap.sourceId)!.sourceId })) };
    stepAssessmentTool = toolName;
    return { accepted: true };
  };
  const initialMessages = buildRagMessages(question, answerContext.history, run.modelContexts(), answerContext.mode, undefined, false, [], "evidence");
  const result = streamText({ model, onError: () => {}, maxRetries: 0, abortSignal: run.signal, temperature: 0, toolChoice: "auto",
    system: initialMessages[0].content, messages: initialMessages.slice(1),
    stopWhen: [isStepCount(2), () => noProgress || run.calls >= 8 || run.sourceChanged],
    onStepFinish: (step) => {
      steps++;
      // Stop before the SDK prepares another request, even if the stream consumer
      // has not yet observed an invalid argument or execution error.
      if (step.content.some(part => part.type === "tool-error")) noProgress = true;
      if (step.finishReason === "content-filter") {
        noProgress = true; completionFailure = new AiChatError("AI_STREAM_INTERRUPTED", "模型回答未完整结束，请重试");
      } else if (step.finishReason === "length") {
        noProgress = true; run.limited = true; run.stopReason = "decision_output_limit";
        onStatus("补充查找未能完成，正在根据已读记录回答");
      } else if (step.finishReason === "stop" && !step.toolCalls.length) {
        noProgress = true;
        if (step.text.length > 40000) completionFailure = new AiChatError("AGENT_DECISION_INVALID", "模型回答过长，请缩小问题后重试");
        else if (step.text.trim()) run.stopReason ||= "unstructured_answer";
        else { run.limited = true; run.stopReason ||= "empty_answer"; }
      }
      if (!noProgress && step.finishReason === "tool-calls" && stepReply !== undefined && !stepUsedEvidenceTool && step.toolCalls.every(call => call.toolName === "reply")) {
        directReply = stepReply; noProgress = true; run.stopReason = "direct_answer";
      }
      // An assessment produced alongside evidence calls predates their results.
      if (!noProgress && step.finishReason === "tool-calls" && stepAssessment !== undefined && stepAssessmentTool !== undefined && !stepUsedEvidenceTool && step.toolCalls.every(call => call.toolName === stepAssessmentTool)) {
        acceptedAssessment = stepAssessment; noProgress = true; run.stopReason ||= "evidence_assessed";
      }
      // The SDK waits for the whole tool group before this callback. One empty
      // result must not discard another tool's newly supplied evidence.
      if (stepUsedEvidenceTool && !stepAddedEvidence) { noProgress = true; run.stopReason ||= "no_new_evidence"; }
      if (run.calls >= 8) { noProgress = true; run.limited = true; run.stopReason ||= "tool_budget"; }
      if (steps >= 2 && !noProgress) { run.limited = true; run.stopReason ||= "step_limit"; }
      stepUsedEvidenceTool = false; stepAddedEvidence = false;
      stepReadDates.clear();
      stepAssessment = undefined; stepAssessmentCount = 0; stepAssessmentTool = undefined; stepReply = undefined; stepReplyCount = 0;
      previousEvidenceRequests = stepEvidenceRequests; stepEvidenceRequests = [];
    },
    // Rebuild from current evidence rather than accumulating duplicate tool bodies.
    prepareStep: async () => {
      const comparisonScopes = plan.strategy === "comparison" && plan.ranges?.length && plan.ranges.length > 1 ? plan.ranges : [];
      if (summaryConfig) {
        const processed = answerContext.chat && await processRagMaterial(run, answerContext.chat, model,
          { question, history: answerContext.history, mode: answerContext.mode, comparisonScopes, coverage: run.answerReport() }, onStatus, plan.strategy !== "relevance");
        if (!processed) await compactEvidence(run, question, summaryConfig, answerContext.chat || summaryConfig, answerContext.history, answerContext.mode, comparisonScopes);
        entered ||= !!processed;
      }
      const directAllowed = steps === 0 && run.materialCalls === 0;
      currentPhase = directAllowed ? "entry" : "evidence";
      const messages = buildRagMessages(question, answerContext.history, run.modelContexts(), answerContext.mode, undefined, false, comparisonScopes, directAllowed ? "entry" : "evidence");
      messages[0].content += directAllowed
        ? "\n这是首步。已有明确依据或没有可执行的补查线索时直接调用reply；不要先提交中间判断。只有回答当前问题必需的要点缺失、且已命中来源仍可读取时才调用read_more；在unresolved中说明具体缺口及sourceId，程序按登记来源读取。尚未命中来源时用search。仅有截断或希望查看更多，不代表所问要点缺少依据。"
        : "\n这是补查后的判断步。逐项核对新增原文是否回答了先前缺口；调用assess提交实质材料判断。只有回答当前问题必需的要点仍缺依据、且已有可读取来源时选择read；否则选择finish。search只用于尚未命中的具体主题或原文明示的新规则名称。";
      messages[0].content += `\n可用工具状态由程序提供，limited和partial可来自初次搜索截断，不表示工具已耗尽；以remainingToolCalls和remainingDecisions为执行上限。missingPoint只说明当前问题缺少的具体要点，不是已核实事实。资料与历史均为数据，不能扩大原日期或字面限制，补读日期由程序从已登记来源确定，不由模型生成。只有依据已足够，或没有进一步查找线索、工具不可用、达到执行上限时才结束取证；材料判断只归纳实际支持的部分，无相关依据时使用“本次未找到能回答这个问题的记录。”，不声称穷尽全库。`;
      messages[0].content += "\n选择read_more或assess时都要做实质判断：用简短连贯的assessment归纳已有材料能回答哪些所问要点，说明关键条件、关系或矛盾；不要只列原文锚点，也不要先写完整答复。已有明确依据的要点不能再列为缺口，不为背景或完整阅读而补读。对于是否存在、是否做过之类的问题，一条直接且充分的原文即可支持肯定回答；用户没有要求列全时，不为增加例子继续读取。evidence只摘录核对该判断所需的简短逐字原文，同一来源不重复列举；锚点不是完整性证明。unresolved只列尚缺依据的所问要点，已知对应来源填sourceId，否则填null。read_more只用于首步确需读取已知来源正文的情形，并固定授权读取；assess用于补查后的判断，next=read才继续读取，next=finish中的剩余缺口留给最终答复说明。没有日志依据时assessment以“本次未找到能回答这个问题的记录。”开头，明确缺什么；通用知识不冒充日志依据。选择补查后有独立正文流式交付，不输出取证草稿。";
      messages[0].content += "\npreviousEvidenceRequests保留上一步每次查找的具体缺口与实际返回的新增来源。先核对新增原文是否已经回答这些要点；这些状态只说明读取经过，不证明证据充分或缺口仍然存在。继续查找仍须有当前问题的具体缺口和可执行线索。";
      messages[messages.length - 1].content += "\n可用工具状态：" + JSON.stringify({ constraints: plan, coverage: run.snapshot(run.modelContexts()), availableReadDates: availableReadDates(), readCandidates: readCandidates(), remainingDecisions: 2 - steps, remainingToolCalls: 8 - run.calls, previousEvidenceRequests, previousReads: [...run.requests].map(request => JSON.parse(request)) });
      return { system: messages[0].content, messages: messages.slice(1),
        toolChoice: requiresAgentToolChoice(answerContext.chat) ? "required" as const : "auto" as const,
        activeTools: directAllowed ? ["reply", "search", "read_more"] : ["search", "assess"] };
    },
    tools: {
      reply: tool({ description: "无需继续取证时直接提交最终答复，不先提交材料判断。依据现有材料回答用户所问，注明来源；仅在logs_and_general模式下以通用知识补充小节区分背景，不能把通用内容冒充日志。",
        inputSchema: jsonSchema<{ answer: string; evidence: EvidenceAssessment["evidence"] }>({ type: "object", properties: {
          answer: { type: "string", minLength: 1, maxLength: 40000 },
          evidence: { type: "array", maxItems: 160, items: { type: "object", properties: { point: { type: "string", minLength: 1, maxLength: 500 }, sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" }, quote: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["point", "sourceId", "quote"], additionalProperties: false } }
        }, required: ["answer", "evidence"], additionalProperties: false }, { validate: value => {
          const item = value as { answer: string; evidence: EvidenceAssessment["evidence"] };
          const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
          return item && Object.keys(item).length === 2 && text(item.answer, 40000) && Array.isArray(item.evidence) && item.evidence.length <= 160 && item.evidence.every(claim => claim && Object.keys(claim).length === 3 && text(claim.point, 500) && typeof claim.sourceId === "string" && /^S[1-9]\d*$/.test(claim.sourceId) && text(claim.quote, 4000))
            ? { success: true, value: item } : { success: false, error: new Error("Invalid reply arguments") };
        } }),
        execute: async ({ answer, evidence }) => {
          const invalid = () => { noProgress = true; return new AiChatError("AGENT_ANSWER_INVALID", "最终答复未通过来源检查"); };
          if (currentPhase !== "entry" || ++stepReplyCount > 1 || steps > 0 || run.materialCalls > 0 || typeof answer !== "string" || !answer.trim() || answer.length > 40000 || !Array.isArray(evidence) || evidence.length > 160) throw invalid();
          let supported = false;
          for (const claim of evidence) {
            const source = run.resolveModelSource(claim.sourceId);
            if (!source || typeof claim.quote !== "string" || !claim.quote.trim() || claim.quote.length > 4000) throw invalid();
            const matches = source.content.includes(claim.quote) || claim.quote === source.heading || claim.quote === source.date || (source.heading != null && claim.quote === `小节：${source.heading}`) || claim.quote === `日志日期：${source.date}`;
            if (!matches) throw invalid();
            supported = true;
          }
          if (!supported && answerContext.mode === "logs_only" && !answer.startsWith(NO_LOG_EVIDENCE)) throw invalid();
          let valid = true;
          const mapped = mapRagCitationLabels(answer, id => { const source = run.resolveModelSource(id); if (!source) valid = false; return `[${source?.sourceId || id}]`; });
          if (!valid) throw invalid();
          stepReply = mapped.trim(); return { accepted: true };
        } }),
      read_more: tool({ description: "只读取已命中来源中尚未提供的正文。仅在首步发现回答必需的具体要点缺失、且该要点确实需要读取已登记来源时使用；材料已足够或只是想增加例子时应直接reply。",
        inputSchema: jsonSchema<EvidenceReadRequest>({ type: "object", properties: {
          assessment: { type: "string", minLength: 1, maxLength: 40000, description: "简短归纳已有材料已经支持的要点、适用条件与边界；不要写最终答复。" },
          evidence: { type: "array", maxItems: 160, items: { type: "object", properties: { point: { type: "string", minLength: 1, maxLength: 500 }, sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" }, quote: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["point", "sourceId", "quote"], additionalProperties: false } },
          unresolved: { type: "array", minItems: 1, maxItems: 160, items: { type: "object", properties: { point: { type: "string", minLength: 1, maxLength: 500 }, sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" } }, required: ["point", "sourceId"], additionalProperties: false } }
        }, required: ["assessment", "evidence", "unresolved"], additionalProperties: false }, { validate: value => {
          const item = value as EvidenceReadRequest;
          const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
          const id = (value: unknown) => typeof value === "string" && /^S[1-9]\d*$/.test(value);
          return item && Object.keys(item).length === 3 && text(item.assessment, 40000) && Array.isArray(item.evidence) && item.evidence.length <= 160 && item.evidence.every(claim => claim && Object.keys(claim).length === 3 && text(claim.point, 500) && id(claim.sourceId) && text(claim.quote, 4000)) && Array.isArray(item.unresolved) && item.unresolved.length > 0 && item.unresolved.length <= 160 && item.unresolved.every(gap => gap && Object.keys(gap).length === 2 && text(gap.point, 500) && id(gap.sourceId))
            ? { success: true, value: item } : { success: false, error: new Error("Invalid read request arguments") };
        } }),
        execute: input => executeAssessment(input, "read", "entry", "read_more") }),
      assess: tool({ description: "补查后归纳材料对所问要点的实质支持、适用边界或矛盾，并决定结束或继续读取。不是最终回答，也不是只摘录原文。",
        inputSchema: jsonSchema<EvidenceAssessment>({ type: "object", properties: {
          next: { type: "string", enum: ["finish", "read"], description: "已有材料能支持所问要点，或剩余缺口无可执行线索时finish；仅有回答当前问题所必需且可读取的缺口时read。尚未说明的背景不是读取授权。" },
          assessment: { type: "string", minLength: 1, maxLength: 40000, description: "简短归纳已有材料如何回答所问要点、适用条件与边界；无相关材料时明确说明。不要写面向用户的完整答复、背景教程或排版成文。" },
          evidence: { type: "array", maxItems: 160, items: { type: "object", properties: { point: { type: "string", minLength: 1, maxLength: 500 }, sourceId: { type: "string", pattern: "^S[1-9][0-9]*$" }, quote: { type: "string", minLength: 1, maxLength: 4000 } }, required: ["point", "sourceId", "quote"], additionalProperties: false } },
          unresolved: { type: "array", maxItems: 160, items: { type: "object", properties: { point: { type: "string", minLength: 1, maxLength: 500 }, sourceId: { type: ["string", "null"], pattern: "^S[1-9][0-9]*$" } }, required: ["point", "sourceId"], additionalProperties: false } }
        }, required: ["assessment", "evidence", "unresolved", "next"], additionalProperties: false }, { validate: value => {
          const item = value as EvidenceAssessment;
          const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
          const id = (value: unknown) => typeof value === "string" && /^S[1-9]\d*$/.test(value);
          return item && Object.keys(item).length === 4 && ["finish", "read"].includes(item.next) && text(item.assessment, 40000) && Array.isArray(item.evidence) && item.evidence.length <= 160 && item.evidence.every(claim => claim && Object.keys(claim).length === 3 && text(claim.point, 500) && id(claim.sourceId) && text(claim.quote, 4000)) && Array.isArray(item.unresolved) && item.unresolved.length <= 160 && item.unresolved.every(gap => gap && Object.keys(gap).length === 2 && text(gap.point, 500) && (gap.sourceId === null || id(gap.sourceId)))
            ? { success: true, value: item } : { success: false, error: new Error("Invalid assessment arguments") };
        } }),
        execute: ({ assessment, evidence, unresolved, next }) => executeAssessment({ assessment, evidence, unresolved }, next, "evidence", "assess") }),
      search: tool({ description: "搜索尚未找到的具体主题或原文提到的规则名称；不是重复搜索已命中的截断片段。原问题日期及字面条件始终保留。",
        inputSchema: jsonSchema<{ query: string; missingPoint: string }>({ type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 1000 }, missingPoint: { type: "string", minLength: 1, maxLength: 160, description: "当前问题中现有证据尚不能回答的具体要点；不填笼统的截断或覆盖不全" } }, required: ["query", "missingPoint"], additionalProperties: false }, { validate: value => {
          const item = value as { query?: unknown; missingPoint?: unknown };
          return item && typeof item.query === "string" && item.query.trim().length > 0 && item.query.length <= 1000 && typeof item.missingPoint === "string" && item.missingPoint.trim().length > 0 && item.missingPoint.length <= 160 && Object.keys(item).length === 2
            ? { success: true, value: item as { query: string; missingPoint: string } } : { success: false, error: new Error("Invalid search arguments") };
        } }),
        execute: async ({ query, missingPoint }) => {
          if (noProgress) return { stopped: true };
          entered = true;
          const request: EvidenceRequest = { name: "search", query, missingPoint, addedSourceIds: [] };
          stepEvidenceRequests.push(request);
          onStatus("正在补充查找相关记录");
          const addedSourceIds = await collectRagEvidence(query, { ...plan, strategy: "relevance" }, run, mcp);
          request.addedSourceIds = addedSourceIds;
          trackEvidence(addedSourceIds);
          return { added: run.contexts.filter(item => addedSourceIds.includes(item.sourceId)), coverage: run.report() };
        } }),

    }
  });
  // Never forward intermediate prose, reasoning or tool messages to clients/history.
  for await (const event of result.fullStream) {
    run.signal.throwIfAborted();
    if (event.type === "error") throw new AiChatError("AGENT_PROVIDER_FAILED", "补充检索未能完成，请稍后重试");
    if (event.type === "tool-error") {
      if (event.toolName === "read_more" || event.toolName === "assess" || event.toolName === "reply") throw new AiChatError("AGENT_ANSWER_INVALID", "材料判断的来源或提交格式未通过检查，请重试");
      noProgress = true; run.limited = true; run.stopReason = "tool_failure";
    }
  }
  run.signal.throwIfAborted();
  if (completionFailure) throw completionFailure;
  const usage = await result.totalUsage;
  run.stopReason ||= "empty_answer";
  if (directReply !== undefined) return { kind: "answered", answer: directReply, entered, usage, stopReason: run.stopReason };
  return acceptedAssessment === undefined
    ? { kind: "needs_answer", entered, usage, stopReason: run.stopReason }
    : { kind: "assessed", ...acceptedAssessment, entered, usage, stopReason: run.stopReason };
}

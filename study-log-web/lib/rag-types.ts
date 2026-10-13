export type RagAnswerMode = "logs_only" | "logs_and_general";
export type RagRetrievalStrategy = "relevance" | "timeline_summary" | "comparison";
/** One bounded evidence set, shared by retrieval, streaming, persistence and follow-ups. */
export const RAG_MAX_SOURCES = 160;

export interface RagHistoryMessage {
  role: "user" | "assistant";
  content: string;
  sourceRefs?: Array<Pick<RagCitation, "date" | "fileName" | "heading" | "contentHash">>;
}

export interface RagPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RagCitation {
  sourceId: string;
  date: string;
  month: string;
  fileName: string;
  heading: string | null;
  headingIndex: number | null;
  chunkId: string;
  contentHash: string;
  excerpt?: string;
}

export interface RagRetrievedContext extends RagCitation {
  dayContentHash?: string;
  dayFullyProvided?: boolean;
  rangeSection?: { heading: string; headingIndex: number };
  content: string;
  truncated: boolean;
  score: number;
  partIndex?: number;
  semanticScore?: number;
  keywordScore?: number;
  matchedTerms?: string[];
}

export interface RagChatMessage extends RagHistoryMessage {
  id: string;
  citations?: RagCitation[];
  status?: "streaming" | "complete" | "stopped" | "error";
  error?: string;
  groundingWarning?: string;
}

export interface RagSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastQuestion: string;
  version: string;
  titleSource: "manual" | "generated" | "fallback";
}

export interface RagSession extends RagSessionSummary {
  answerMode: RagAnswerMode;
  messages: RagChatMessage[];
}

export interface RagDiagnostics {
  agent?: { enabled: boolean; answeredDirectly?: boolean; usage?: unknown; firstPassUsage?: unknown; firstPassLimited?: boolean; judgment?: { support: string; conflict: string }; judgeUsage?: unknown; judgeUnavailable?: boolean; judgeSkipped?: "outside_short_evidence_scope"; stopReason?: string };
  rangeStatusVerification?: { enabled: boolean; claimCount: number; removedCount: number; failed?: boolean };
  coverage?: unknown;
  toolCalls?: number;
  usage?: Array<{ model: string; inputTokens: number | null; outputTokens: number | null }>;
  traceId: string;
  status: "completed" | "no_evidence" | "error";
  answerMode: RagAnswerMode;
  questionChars: number;
  historyMessages: number;
  contextualized: boolean;
  contextualizationFallback: boolean;
  retrievalMode: string | null;
  retrievalStrategy: RagRetrievalStrategy;
  retrievalPlanner: "rules" | "llm" | "fallback";
  sourceCount: number;
  failureStage?: "contextualizing" | "planning" | "retrieving" | "answering";
  timings: {
    contextualizationMs: number;
    planningMs: number;
    retrievalMs: number;
    compactionMs?: number;
    judgeMs?: number;
    agentMs?: number;
    statusVerificationMs?: number;
    firstTokenMs: number | null;
    generationMs: number;
    totalMs: number;
  };
}

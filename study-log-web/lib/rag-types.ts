export type RagAnswerMode = "logs_only" | "logs_and_general";
export type RagRetrievalStrategy = "relevance" | "timeline_summary" | "comparison";

export interface RagHistoryMessage {
  role: "user" | "assistant";
  content: string;
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
    firstTokenMs: number | null;
    generationMs: number;
    totalMs: number;
  };
}

import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types";

export type RagTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface RagTaskSubmission {
  submissionId: string; sessionId: string; baseVersion: string | null; question: string; mode: RagAnswerMode;
  history: RagHistoryMessage[]; replaceLast?: boolean; retryTaskId?: string; editMessageId?: string;
}
export interface RagTaskResult { answer: string; citations: RagCitation[]; groundingWarning?: string; diagnostics?: RagDiagnostics }
export interface RagTask {
  editMessageId?: string;
  applicable?: boolean;
  questionMessageId?: string;
  previousAnswer?: import("./rag-types").RagChatMessage;
  id: string; sessionId: string; submissionId: string; state: RagTaskState; revision: number;
  createdAt: string; updatedAt: string; question: string; mode: RagAnswerMode; partial: string; stage: string;
  result: RagTaskResult | null; error: string; errorCode: string; replaceLast?: boolean; saveState: "pending" | "saved" | "conflict" | "error" | "deleted";
  saveError: string;
}
export type RagTaskSummary = Pick<RagTask, "id" | "sessionId" | "submissionId" | "state" | "revision" | "createdAt" | "updatedAt" | "mode" | "stage" | "errorCode" | "saveState" | "applicable"> & { questionPreview: string };
export const ragTaskActive = (task: Pick<RagTask, "state">) => task.state === "queued" || task.state === "running";

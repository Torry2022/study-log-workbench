import type { RagAnswerMode, RagCitation, RagDiagnostics, RagHistoryMessage } from "./rag-types";

export type RagTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface RagTaskSubmission {
  submissionId: string; sessionId: string; baseVersion: string | null; question: string; mode: RagAnswerMode;
  history: RagHistoryMessage[]; replaceLast?: boolean;
}
export interface RagTaskResult { answer: string; citations: RagCitation[]; groundingWarning?: string; diagnostics?: RagDiagnostics }
export interface RagTask {
  id: string; sessionId: string; submissionId: string; state: RagTaskState; revision: number;
  createdAt: string; updatedAt: string; question: string; mode: RagAnswerMode; partial: string; stage: string;
  result: RagTaskResult | null; error: string; errorCode: string; replaceLast?: boolean; saveState: "pending" | "saved" | "conflict" | "error" | "deleted";
  saveError: string;
}
export type RagTaskSummary = Pick<RagTask, "id" | "sessionId" | "submissionId" | "state" | "revision" | "createdAt" | "updatedAt" | "mode" | "stage" | "errorCode" | "saveState"> & { questionPreview: string };
export const ragTaskActive = (task: Pick<RagTask, "state">) => task.state === "queued" || task.state === "running";

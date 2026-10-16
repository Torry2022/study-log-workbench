import { chatContextWindowTokens, type ChatConfig } from "./ai-config.ts";
import { buildRagMessages } from "./rag-answer.ts";
import type { RagAnswerMode, RagHistoryMessage, RagRetrievedContext } from "./rag-types.ts";

export interface MaterialPart {
  sourceId: string;
  date: string;
  contentHash: string;
  start: number;
  end: number;
  text: string;
}
export interface MaterialOptions {
  question: string;
  history: RagHistoryMessage[];
  mode: RagAnswerMode;
  coverage?: string;
  comparisonScopes: Array<{ dateFrom: string; dateTo: string }>;
  additionalPrompt?: string;
}

/** Plan against the declared capacity, without changing the evidence registry. */
export function planRagMaterial(contexts: readonly RagRetrievedContext[], config: ChatConfig, options: MaterialOptions) {
  const window = chatContextWindowTokens(config);
  const unit = window === undefined ? "characters" as const : "utf8_bytes" as const;
  const measure = (text: string) => unit === "characters" ? text.length : Buffer.byteLength(text, "utf8");
  const messages = buildRagMessages(options.question, options.history, contexts.map(item => ({ ...item, content: "" })),
    options.mode, options.coverage, false, options.comparisonScopes);
  const promptSize = Buffer.byteLength(JSON.stringify(messages), "utf8");
  const evidenceLimit = window === undefined ? Math.max(0, 30000 - (options.additionalPrompt?.length || 0))
    : Math.max(0, window - 65536 - 32768 - promptSize - Buffer.byteLength(options.additionalPrompt || "", "utf8"));
  // Leave half the admitted evidence capacity for retained working material.
  const batchLimit = Math.min(15000, Math.floor(evidenceLimit / 2));
  const batches: Array<{ parts: MaterialPart[]; size: number }> = [];
  if (contexts.reduce((sum, item) => sum + measure(item.content), 0) <= evidenceLimit)
    return { kind: "direct" as const, unit, evidenceLimit, batchLimit, batches };
  if (batchLimit < 4) throw new Error("Question and history exceed model input capacity");
  for (const item of contexts) {
    let start = 0;
    while (start < item.content.length) {
      let batch = batches[batches.length - 1];
      if (!batch || batch.size + 4 > batchLimit) { batch = { parts: [], size: 0 }; batches.push(batch); }
      let end = start, size = 0;
      for (const character of item.content.slice(start)) {
        const next = measure(character);
        if (batch.size + size + next > batchLimit) break;
        end += character.length; size += next;
      }
      batch.parts.push({ sourceId: item.sourceId, date: item.date, contentHash: item.contentHash,
        start, end, text: item.content.slice(start, end) });
      batch.size += size; start = end;
    }
  }
  return { kind: "batches" as const, unit, evidenceLimit, batchLimit, batches };
}

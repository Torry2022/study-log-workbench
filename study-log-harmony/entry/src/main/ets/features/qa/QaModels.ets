export interface RagSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastQuestion: string;
  version: string;
}

export interface RagHistoryMessage {
  role: string;
  content: string;
}

export interface RagChatMessage extends RagHistoryMessage {
  id: string;
  citations?: RagCitation[];
  status?: string;
  error?: string;
  groundingWarning?: string;
}

export interface RagCitation {
  sourceId: string;
  excerpt?: string;
  date: string;
  month: string;
  fileName: string;
  heading: string | null;
  headingIndex: number | null;
  chunkId: string;
  contentHash: string;
}

export interface RagSession extends RagSessionSummary {
  answerMode: string;
  messages: RagChatMessage[];
}

export interface RagSessionsResponse {
  sessions: RagSessionSummary[];
}

export interface RagSessionResponse {
  session: RagSession;
}

export interface RagQueryRequest {
  question: string;
  history: RagHistoryMessage[];
  mode: string;
}

export interface RagSessionWriteRequest {
  messages: RagChatMessage[];
  answerMode: string;
  mutationId: string;
  baseVersion: string | null;
  id?: string;
}

export interface RagStatusEvent {
  message: string;
}

export interface RagDeltaEvent {
  text: string;
}

export interface RagSourcesEvent {
  citations: RagCitation[];
}

export interface RagDoneEvent {
  answer: string;
  citations?: RagCitation[];
  groundingWarning?: string;
}

export interface RagErrorEvent {
  message: string;
}

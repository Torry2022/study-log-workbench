export interface StudyNote {
  id: string;
  title: string;
  body: string;
  insight: string;
  sources: string[];
  tags: string[];
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  year: string;
  version: string;
  displayTitle: string;
}

export interface StudyNoteFacet {
  value: string;
  count: number;
}

export interface StudyNotesPayload {
  notes: StudyNote[];
  years: StudyNoteFacet[];
  tags: StudyNoteFacet[];
}

export interface StudyNoteRequest {
  title: string;
  body: string;
  insight: string;
  sources: string[];
  tags: string[];
  recordedAt: string;
}

export interface StudyNoteResponse {
  note: StudyNote;
}

export type StudyNoteCandidateKind = 'explicit' | 'inferred';

export interface StudyNoteCandidateEvidence {
  sourceId: string;
  sourceLabel: string;
  quote: string;
}

export interface StudyNoteCandidate {
  id: string;
  kind: StudyNoteCandidateKind;
  title: string;
  body: string;
  insight: string;
  sources: string[];
  tags: string[];
  newTags: string[];
  evidence: StudyNoteCandidateEvidence[];
}

export interface StudyNoteCandidateDocument {
  fileName: string;
  fileType: string;
  size: number;
  sectionCount: number;
}

export interface StudyNoteCandidateResult {
  candidates: StudyNoteCandidate[];
  documents: StudyNoteCandidateDocument[];
  warnings: string[];
  model: string;
}

export interface StudyNoteCandidateResponse {
  result: StudyNoteCandidateResult;
}

export interface StudyNoteBatchRequest {
  notes: StudyNoteBatchItem[];
}

export interface StudyNoteBatchItem extends StudyNoteRequest {
  clientId: string;
}

export interface StudyNoteBatchResponse {
  notes: StudyNote[];
}

export interface UpdateStudyNoteRequest extends StudyNoteRequest {
  id: string;
  baseVersion: string | null;
}

export interface DeleteStudyNoteRequest {
  id: string;
  baseVersion: string | null;
}

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
export interface StudyNoteFacet { value: string; count: number }
export interface StudyNotesPayload { notes: StudyNote[]; years: StudyNoteFacet[]; tags: StudyNoteFacet[] }
export type StoredNote = Omit<StudyNote, "year" | "version" | "displayTitle">;
export interface StudyNoteInput {
  title?: string;
  body: string;
  insight?: string;
  sources?: string[];
  tags?: string[];
  recordedAt: string;
}
export interface UpdateStudyNoteInput extends StudyNoteInput { id: string; baseVersion: string }
export class NoteInputError extends Error {}
export class NoteFormatError extends Error {
  constructor() { super("随记源文件格式异常，请先核对 Markdown 文件，未覆盖资料"); }
}
export class NoteConflictError extends Error {
  constructor() { super("随记已在其他位置发生变化，请保留草稿并重新读取后核对"); }
}
export class NoteNotFoundError extends Error {
  constructor() { super("未找到该随记"); }
}
export class NoteRecoveryError extends Error {
  constructor() { super("上次跨年随记写入未完成，请先根据写入前备份恢复资料后移除待恢复标记"); }
}

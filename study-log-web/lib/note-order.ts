type NoteTime = { recordedAt: string; updatedAt?: string | null };

export function compareNoteUpdates(a: NoteTime, b: NoteTime): number {
  return Date.parse(b.updatedAt || b.recordedAt) - Date.parse(a.updatedAt || a.recordedAt)
    || Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
}

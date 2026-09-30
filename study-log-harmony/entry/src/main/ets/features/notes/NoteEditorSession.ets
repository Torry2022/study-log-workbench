import { StudyNote, StudyNoteRequest } from './NoteModels';
import { util } from '@kit.ArkTS';
import { PreservedNoteDraft } from './NoteDraftStore';

@Observed
export class NoteEditorSession {
  editing: boolean = false;
  editingId: string = '';
  clientId: string = '';
  title: string = '';
  body: string = '';
  insight: string = '';
  sourcesText: string = '';
  tagsText: string = '';
  recordedAt: string = '';
  baseVersion: string = '';
  baseline: string = '';
  revision: number = 0;

  value(): string {
    return JSON.stringify([this.title, this.body, this.insight, this.sourcesText, this.tagsText, this.recordedAt]);
  }

  draft(namespace: string): PreservedNoteDraft {
    return { namespace, editingId: this.editingId, clientId: this.clientId,
      title: this.title, body: this.body, insight: this.insight, sourcesText: this.sourcesText,
      tagsText: this.tagsText, recordedAt: this.recordedAt, baseVersion: this.baseVersion,
      baseline: this.baseline };
  }

  restore(draft: PreservedNoteDraft): void {
    this.revision += 1;
    this.editing = true;
    this.editingId = draft.editingId; this.clientId = draft.clientId;
    this.title = draft.title; this.body = draft.body; this.insight = draft.insight;
    this.sourcesText = draft.sourcesText; this.tagsText = draft.tagsText;
    this.recordedAt = draft.recordedAt; this.baseVersion = draft.baseVersion;
    this.baseline = draft.baseline;
  }

  startNew(recordedAt: string): void {
    this.revision += 1;
    this.editing = true;
    this.editingId = '';
    this.clientId = util.generateRandomUUID();
    this.title = ''; this.body = ''; this.insight = ''; this.sourcesText = ''; this.tagsText = '';
    this.recordedAt = recordedAt;
    this.baseVersion = '';
    this.baseline = this.value();
  }

  startEdit(note: StudyNote): void {
    this.revision += 1;
    this.editing = true;
    this.editingId = note.id;
    this.clientId = '';
    this.title = note.title; this.body = note.body; this.insight = note.insight;
    this.sourcesText = note.sources.join('\n'); this.tagsText = note.tags.join('，');
    this.recordedAt = note.recordedAt;
    this.baseVersion = note.version;
    this.baseline = this.value();
  }

  request(): StudyNoteRequest {
    return { title: this.title.trim(), body: this.body.trim(), insight: this.insight.trim(),
      sources: this.sourcesText.split('\n').map((value: string) => value.trim()).filter((value: string) => value.length > 0),
      tags: this.tagsText.split(/[，,、\n]/).map((value: string) => value.trim()).filter((value: string) => value.length > 0),
      recordedAt: this.recordedAt };
  }
}

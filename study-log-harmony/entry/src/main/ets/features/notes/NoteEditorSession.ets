import { StudyNote, StudyNoteRequest } from './NoteModels';

@Observed
export class NoteEditorSession {
  editing: boolean = false;
  editingId: string = '';
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

  startNew(recordedAt: string): void {
    this.revision += 1;
    this.editing = true;
    this.editingId = '';
    this.title = ''; this.body = ''; this.insight = ''; this.sourcesText = ''; this.tagsText = '';
    this.recordedAt = recordedAt;
    this.baseVersion = '';
    this.baseline = this.value();
  }

  startEdit(note: StudyNote): void {
    this.revision += 1;
    this.editing = true;
    this.editingId = note.id;
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

import { DayEntry } from './LogModels';

// Migrated from the personal LogSession. Transport and editor readiness remain outside this state.
@Observed
export class LogSession {
  day: DayEntry | undefined = undefined;
  selectedDate: string = '';
  text: string = '';
  baseline: string = '';
  editorInitialText: string = '';
  editorPending: boolean = false;
  baseVersion: string | null = null;

  commitDocument(day: DayEntry, body: string): void {
    this.day = day;
    this.selectedDate = day.date;
    this.baseline = body;
    this.baseVersion = day.version;
    this.resetEditor(body);
  }

  resetEditor(text: string): void {
    this.text = text;
    this.editorPending = false;
    this.editorInitialText = text;
    // Public SourceEditorSession owns the date key and explicit same-document replacement.
  }

  clearDocument(): void {
    this.day = undefined;
    this.selectedDate = '';
  }

  isDirty(): boolean {
    return this.editorPending || this.text !== this.baseline;
  }

  acceptSaved(day: DayEntry, text: string): void {
    // A save acknowledges its captured text, not newer typing in this.text.
    this.day = day;
    this.baseline = text;
    this.baseVersion = day.version;
    this.editorPending = false;
  }
}

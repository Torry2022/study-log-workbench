import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { NoteEditorSession } from './NoteEditorSession';
import { StudyNote, StudyNoteFacet, StudyNoteRequest, StudyNotesPayload, StudyNoteResponse, StudyNoteBatchRequest,
  StudyNoteBatchResponse, UpdateStudyNoteRequest, DeleteStudyNoteRequest } from './NoteModels';

interface DeleteResponse { ok: boolean; }

export interface NotesView {
  blocked: () => boolean;
  uploading: () => boolean;
  navigationChanged: (years: StudyNoteFacet[], tags: StudyNoteFacet[], total: number) => void;
  loaded: () => void;
  success: (message: string) => void;
  failure: (message: string) => void;
}

@Observed
export class NotesController {
  notes: StudyNote[] = [];
  availableTags: StudyNoteFacet[] = [];
  loading: boolean = true;
  saving: boolean = false;
  exporting: boolean = false;
  deletingId: string = '';
  errorMessage: string = '';
  loadFailed: boolean = false;
  private lifetime: number = 0;
  private loadRevision: number = 0;
  private transport: ApiClient;
  private editor: NoteEditorSession;
  private view: NotesView;

  constructor(transport: ApiClient, editor: NoteEditorSession, view: NotesView) {
    this.transport = transport; this.editor = editor; this.view = view;
  }

  generation(): number { return this.lifetime; }

  dispose(): void {
    this.lifetime += 1;
    this.loadRevision += 1;
    this.saving = false;
    this.exporting = false;
    this.deletingId = '';
  }

  async load(): Promise<void> {
    const revision = ++this.loadRevision;
    this.loading = true; this.loadFailed = false; this.errorMessage = '';
    try {
      const response = await this.transport.get<StudyNotesPayload>('/notes');
      if (revision !== this.loadRevision) return;
      this.notes = response.notes; this.availableTags = response.tags;
      this.view.navigationChanged(response.years, response.tags, response.notes.length);
      this.view.loaded();
    } catch (error) {
      if (revision !== this.loadRevision) return;
      this.errorMessage = this.message(error, '随记读取失败');
      this.loadFailed = true;
    } finally { if (revision === this.loadRevision) this.loading = false; }
  }

  filtered(year: string, tag: string, query: string): StudyNote[] {
    const needle = query.trim().toLowerCase();
    return this.notes.filter((note: StudyNote) => {
      if (year !== 'all' && note.year !== year) return false;
      if (tag !== 'all' && !note.tags.includes(tag)) return false;
      return !needle || `${note.displayTitle}\n${note.body}\n${note.insight}\n${note.sources.join(' ')}\n${note.tags.join(' ')}`
        .toLowerCase().includes(needle);
    });
  }

  private applyLocalNotes(notes: StudyNote[]): void {
    this.notes = notes.sort((left: StudyNote, right: StudyNote) =>
      Date.parse(right.updatedAt || right.recordedAt) - Date.parse(left.updatedAt || left.recordedAt) ||
      Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
    const facets = (values: string[]): StudyNoteFacet[] => {
      const counts = new Map<string, number>();
      values.forEach((value: string) => counts.set(value, (counts.get(value) || 0) + 1));
      const result: StudyNoteFacet[] = [];
      counts.forEach((count: number, value: string) => result.push({ value, count }));
      return result;
    };
    const years = facets(this.notes.map((note: StudyNote) => note.year)).sort((left: StudyNoteFacet, right: StudyNoteFacet) =>
      right.value.localeCompare(left.value));
    this.availableTags = facets(this.notes.flatMap((note: StudyNote) => Array.from(new Set(note.tags))))
      .sort((left: StudyNoteFacet, right: StudyNoteFacet) => right.count - left.count || left.value.localeCompare(right.value));
    this.view.navigationChanged(years, this.availableTags, this.notes.length);
    this.view.loaded();
  }

  async save(): Promise<void> {
    if (this.view.blocked()) return;
    if (!this.editor.body.trim() || this.saving || this.view.uploading()) {
      if (!this.editor.body.trim()) this.errorMessage = '请填写正文';
      return;
    }
    const lifetime = this.lifetime;
    const revision = this.editor.revision;
    const snapshot = this.editor.value();
    const id = this.editor.editingId;
    const expectedId = id || this.editor.clientId;
    const body = this.editor.request();
    this.saving = true; this.errorMessage = '';
    try {
      let response: StudyNoteResponse;
      if (id) {
        const request: UpdateStudyNoteRequest = { id, baseVersion: this.editor.baseVersion,
          title: body.title, body: body.body, insight: body.insight, sources: body.sources,
          tags: body.tags, recordedAt: body.recordedAt };
        response = await this.transport.patch<StudyNoteResponse>('/notes', request);
      } else {
        const request: StudyNoteBatchRequest = { notes: [{ title: body.title, body: body.body,
          insight: body.insight, sources: body.sources, tags: body.tags,
          recordedAt: body.recordedAt, clientId: this.editor.clientId }] };
        const result = await this.transport.post<StudyNoteBatchResponse>('/notes/batch', request);
        if (lifetime !== this.lifetime || revision !== this.editor.revision) return;
        if (!result || !Array.isArray(result.notes) || result.notes.length !== 1) {
          this.errorMessage = '未能确认保存结果，草稿仍保留，请重试';
          return;
        }
        response = { note: result.notes[0] };
      }
      if (lifetime !== this.lifetime || revision !== this.editor.revision) return;
      if (!response || !response.note || response.note.id !== expectedId) {
        this.errorMessage = '未能确认保存结果，草稿仍保留，请重试';
        return;
      }
      // Keep any input delivered after submission; the saved baseline is the submitted snapshot.
      this.editor.editingId = response.note.id;
      this.editor.baseVersion = response.note.version;
      this.editor.baseline = snapshot;
      if (this.editor.value() === snapshot) this.editor.editing = false;
      this.applyLocalNotes([response.note, ...this.notes.filter((note: StudyNote) => note.id !== response.note.id)]);
      await this.load();
      if (lifetime === this.lifetime && revision === this.editor.revision) this.view.success(id ? '随记已更新' : '随记已保存');
    } catch (error) {
      if (lifetime !== this.lifetime || revision !== this.editor.revision) return;
      if (id && this.maybeCompleted(error)) {
        try {
          const current = await this.transport.get<StudyNotesPayload>('/notes');
          const saved = current.notes.find((note: StudyNote) => note.id === id);
          if (saved && this.matchesSaved(saved, body) && lifetime === this.lifetime && revision === this.editor.revision) {
            this.editor.baseVersion = saved.version;
            this.editor.baseline = snapshot;
            if (this.editor.value() === snapshot) this.editor.editing = false;
            this.applyLocalNotes([saved, ...this.notes.filter((note: StudyNote) => note.id !== saved.id)]);
            await this.load();
            if (lifetime === this.lifetime && revision === this.editor.revision) this.view.success('随记已更新');
            return;
          }
          if (error instanceof ApiError && error.statusCode === 409 && lifetime === this.lifetime &&
            revision === this.editor.revision) {
            this.loadRevision += 1;
            this.loading = false; this.loadFailed = false;
            this.notes = current.notes; this.availableTags = current.tags;
            this.view.navigationChanged(current.years, current.tags, current.notes.length);
            this.view.loaded();
          }
        } catch (_) { /* Retain the draft and report the original write error. */ }
      }
      if (lifetime !== this.lifetime || revision !== this.editor.revision) return;
      this.errorMessage = error instanceof ApiError && error.statusCode === 409 ?
        '服务器随记已变化，未覆盖。当前编辑仍保留，请先复制内容，再重新打开核对。' : this.message(error, '随记保存失败');
    } finally { if (lifetime === this.lifetime) this.saving = false; }
  }

  async deleteNote(note: StudyNote): Promise<void> {
    if (this.deletingId) return;
    const lifetime = this.lifetime;
    this.deletingId = note.id; this.errorMessage = '';
    try {
      const request: DeleteStudyNoteRequest = { id: note.id, baseVersion: note.version };
      await this.transport.delete<DeleteResponse>('/notes', request);
      if (lifetime !== this.lifetime) return;
      this.applyLocalNotes(this.notes.filter((item: StudyNote) => item.id !== note.id));
      await this.load();
      if (lifetime === this.lifetime) this.view.success('随记已删除');
    } catch (error) {
      if (lifetime !== this.lifetime) return;
      if (this.maybeCompleted(error) || error instanceof ApiError && error.statusCode === 404) {
        try {
          const current = await this.transport.get<StudyNotesPayload>('/notes');
          if (!current.notes.some((item: StudyNote) => item.id === note.id) && lifetime === this.lifetime) {
            this.applyLocalNotes(this.notes.filter((item: StudyNote) => item.id !== note.id));
            await this.load();
            if (lifetime === this.lifetime) this.view.success('随记已删除');
            return;
          }
        } catch (_) { /* Keep the original error when the server cannot be checked. */ }
      }
      if (lifetime !== this.lifetime) return;
      this.errorMessage = this.message(error, '删除随记失败');
    } finally { if (lifetime === this.lifetime) this.deletingId = ''; }
  }

  async exportNotes(save: (data: ArrayBuffer, current: () => boolean) => Promise<boolean>): Promise<void> {
    if (this.exporting) return;
    const lifetime = this.lifetime;
    const current = (): boolean => lifetime === this.lifetime;
    this.exporting = true;
    try {
      const data = await this.transport.download('/export?scope=notes');
      if (current() && await save(data, current) && current()) this.view.success('随记已导出');
    } catch (error) {
      if (current()) this.view.failure(this.message(error, '随记导出失败'));
    } finally { if (current()) this.exporting = false; }
  }

  private message(error: Object, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }

  private maybeCompleted(error: Object): boolean {
    return error instanceof ApiError && (error.statusCode === 0 || error.statusCode === 409 || error.statusCode >= 500);
  }

  private matchesSaved(note: StudyNote, request: StudyNoteRequest): boolean {
    const normalized = (values: string[]): string[] => Array.from(new Set(values.map((value: string) =>
      value.replace(/\s+/g, ' ').trim()).filter((value: string) => value.length > 0)));
    return note.title === request.title.replace(/\s+/g, ' ').trim() && note.body === request.body.replace(/\r\n/g, '\n').trim() &&
      note.insight === request.insight.replace(/\r\n/g, '\n').trim() && note.recordedAt === request.recordedAt &&
      JSON.stringify(note.sources) === JSON.stringify(normalized(request.sources)) &&
      JSON.stringify(note.tags) === JSON.stringify(normalized(request.tags));
  }
}

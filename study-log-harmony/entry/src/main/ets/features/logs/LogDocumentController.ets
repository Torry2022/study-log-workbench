import { ApiError } from '../../common/network/ApiClient';
import { EditorSnapshot } from '../../common/editor/SourceEditor';
import { DayEntry } from './LogModels';
import { matchesSubmittedDay } from './LogDayBody';
import { LogSession } from './LogSession';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';

export interface LogDocumentView {
  locked: () => boolean;
  lifecycle: () => number;
  flushEditor: () => Promise<EditorSnapshot>;
  draftChanged: () => void;
  saved: (day: DayEntry, text: string, date: string) => void;
  notice: (message: string) => void;
  beforeRead: () => void;
  beforeChange: () => Promise<void>;
  readingStarted: () => void;
  installed: (day: DayEntry, date: string, heading: string, headingIndex: number) => void;
  failed: (date: string, heading: string, headingIndex: number, error: Error) => void;
  readFinished: (date: string, revision: number, lifecycle: number) => void;
}

// Original LogDocumentController boundary, adapted to the public versioned write contract.
// Editor commands and UI feedback stay in the view; the transaction owns no ArkUI component.
@Observed
export class LogDocumentController {
  saving: boolean = false;
  dayRequestLoading: boolean = false;
  dayLoadRevision: number = 0;
  private view?: LogDocumentView;
  private session: LogSession;
  private reads: LogReadRepository;
  private writes: LogWriteRepository;

  constructor(session: LogSession, reads: LogReadRepository, writes: LogWriteRepository) {
    this.session = session;
    this.reads = reads;
    this.writes = writes;
  }

  bind(view: LogDocumentView): void { this.view = view; }
  dispose(): void { this.view = undefined; this.dayLoadRevision++; this.saving = false; this.dayRequestLoading = false; }

  async loadDay(date: string, heading: string = '', headingIndex: number = -1): Promise<void> {
    const view = this.view;
    if (!view) return;
    view.beforeRead();
    const lifecycle = view.lifecycle();
    const revision = ++this.dayLoadRevision;
    await view.beforeChange();
    if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision) return;
    this.dayRequestLoading = true;
    view.readingStarted();
    try {
      const response = await this.reads.day(date);
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision) return;
      if (!response.day || response.day.date !== date || typeof response.day.content !== 'string') {
        throw new Error('日块响应格式异常');
      }
      view.installed(response.day, date, heading, headingIndex);
    } catch (error) {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.dayLoadRevision) {
        view.failed(date, heading, headingIndex, error as Error);
      }
    } finally {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.dayLoadRevision) {
        this.dayRequestLoading = false;
        view.readFinished(date, revision, lifecycle);
      }
    }
  }

  async save(): Promise<void> {
    const view = this.view;
    if (!view || !this.session.day || this.saving || view.locked()) return;
    const lifecycle = view.lifecycle();
    const revision = this.dayLoadRevision;
    const date = this.session.day.date;
    this.saving = true;
    view.notice('');
    let submittedText: string | undefined = undefined;
    try {
      const snapshot = await view.flushEditor();
      if (snapshot.documentKey !== date || this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision) return;
      this.session.text = snapshot.text;
      this.session.editorPending = false;
      view.draftChanged();
      if (!this.session.isDirty()) return;
      if (this.session.baseVersion !== this.session.day.version) {
        view.notice('恢复的草稿基于旧版本，服务器内容已变化。请复制草稿并刷新核对，未覆盖服务器。');
        return;
      }
      submittedText = snapshot.text;
      const response = await this.writes.save({ date, content: snapshot.text, baseVersion: this.session.day.version });
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision || this.session.day?.date !== date) return;
      if (!response.day || response.day.date !== date || !response.day.version) throw new Error('保存响应格式异常');
      view.saved(response.day, snapshot.text, date);
    } catch (error) {
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision) return;
      const uncertain = !(error instanceof ApiError) || error.statusCode === 0 || error.statusCode === 409 ||
        error.statusCode >= 500 || error.code === 'INVALID_RESPONSE';
      if (submittedText !== undefined && uncertain) {
        try {
          const current = await this.reads.day(date);
          if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision || this.session.day?.date !== date) return;
          if (matchesSubmittedDay(current.day, submittedText)) {
            view.saved(current.day, submittedText, date);
            return;
          }
          if (current.day.version !== this.session.day?.version) {
            view.notice('源文件已变化，未覆盖。当前草稿仍保留，请先复制内容再刷新核对。');
            return;
          }
        } catch (_) { if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.dayLoadRevision) return; }
      }
      view.notice(error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未覆盖。当前草稿仍保留，请先复制内容再刷新核对。' :
          error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.dayLoadRevision) this.saving = false;
    }
  }

}

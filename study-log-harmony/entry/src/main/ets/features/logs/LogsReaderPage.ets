import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { apiClient, ApiError, ApiUploadFile } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { EmptyState, LoadFailure } from '../../common/ui/FeedbackStates';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { workspaceDateFamily, workspaceSansFamily } from '../../common/ui/Typography';
import { AppLogo } from '../../common/ui/AppLogo';
import { SourceEditor, SourceEditorSession, EditorSnapshot, EditorImageData } from '../../common/editor/SourceEditor';
import { common } from '@kit.AbilityKit';
import { saveExport } from '../../common/files/DocumentExport';
import { EditorLinkPicker } from '../../common/editor/EditorLinkPicker';
import { DayEntry, DaySummary, MonthSummary } from './LogModels';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';
import { LogNavigation } from './components/LogNavigation';
import { DesktopLogHeader } from './components/DesktopLogHeader';
import { BackupPanel } from './components/BackupPanel';
import { LogImageUpload } from './LogImageUpload';
import { LogSearchPanel, LogSearchResult } from './LogSearchPanel';
import { LogSearchRepository } from './LogSearchRepository';

export interface PreservedLogDraft {
  namespace: string;
  date: string;
  text: string;
}

@Component
export struct LogsReaderPage {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  onChangeServer: () => void = () => {};
  onDraftChange: (draft: PreservedLogDraft | undefined) => void = () => {};
  onCaptureDraft: (capture: () => Promise<PreservedLogDraft | undefined>) => void = () => {};
  initialDraft: PreservedLogDraft | undefined = undefined;
  @State private months: MonthSummary[] = [];
  @State private days: DaySummary[] = [];
  @State private month: string = '';
  @State private selectedDate: string = '';
  @State private day: DayEntry | undefined = undefined;
  @State private monthsLoading: boolean = true;
  @State private daysLoading: boolean = false;
  @State private dayLoading: boolean = false;
  @State private errorMessage: string = '';
  @State private navigationError: string = '';
  @State private navigationOpen: boolean = false;
  @State private navigationMonthsExpanded: boolean = false;
  @State private navigationDayQuery: string = '';
  @State private targetHeading: string = '';
  @State private targetHeadingIndex: number = -1;
  @State private targetRevision: number = 0;
  @State private headerWidth: number = 600;
  @State private headerDateWidth: number = 190;
  @State private sourceMode: boolean = false;
  @State private splitMode: boolean = false;
  @State private editorReady: boolean = false;
  @State private draftText: string = '';
  @State private editorInitialText: string = '';
  @State private previewText: string = '';
  @State private savedText: string = '';
  @State private dirty: boolean = false;
  @State private saving: boolean = false;
  @State private deleting: boolean = false;
  @State private backupOpen: boolean = false;
  @State private backupBusy: boolean = false;
  @State private linkOpen: boolean = false;
  @State private linkOpening: boolean = false;
  @State private imageBusy: boolean = false;
  @State private exportBusy: boolean = false;
  @State private exportMenuOpen: boolean = false;
  @State private searchOpen: boolean = false;
  @State private searchQuery: string = '';
  @State private searchHeadingsOnly: boolean = false;
  @State private searchIgnoreCase: boolean = true;
  @State private searchLoading: boolean = false;
  @State private searchSubmitted: boolean = false;
  @State private searchError: string = '';
  @State private searchResults: LogSearchResult[] = [];
  @State private linkAlias: string = '';
  @State private moreOpen: boolean = false;
  @State private saveError: string = '';
  @State private newLogDate: string = '';
  @State private calendarMonth: string = '';
  @State private calendarDates: string[] = [];
  @State private calendarMode: string = 'create';
  @State private calendarOpen: boolean = false;
  @State private calendarLoading: boolean = false;
  @State private calendarError: boolean = false;
  private reads: LogReadRepository = new LogReadRepository(apiClient);
  private writes: LogWriteRepository = new LogWriteRepository(apiClient);
  private searches: LogSearchRepository = new LogSearchRepository(apiClient);
  private editor: SourceEditorSession = new SourceEditorSession();
  private lifecycle: number = 0;
  private listRevision: number = 0;
  private dayRevision: number = 0;
  private restoredDraftApplied: boolean = false;
  private leaveCheckPending: boolean = false;
  private calendarRevision: number = 0;
  private linkTarget: EditorSnapshot | undefined = undefined;
  private searchRevision: number = 0;

  aboutToAppear(): void {
    this.lifecycle++;
    this.onCaptureDraft(() => this.captureDraft());
    this.editor.onReadyChange = (ready: boolean) => this.editorReady = ready;
    this.editor.onChange = (snapshot: EditorSnapshot) => {
      if (snapshot.documentKey !== this.selectedDate) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      if (this.splitMode) this.previewText = snapshot.text;
      this.reportDraft();
    };
    this.editor.onDirty = (key: string) => {
      if (key === this.selectedDate) { this.dirty = true; this.reportDraft(); }
    };
    this.editor.onFailure = (message: string) => this.saveError = message;
    this.editor.onCommand = (command: string) => {
      if (command === 'save') this.save();
      else if (command === 'globalSearch') this.searchOpen = true;
    };
    this.editor.onImages = (target: EditorSnapshot, images: EditorImageData[]) => this.receiveImages(target, images);
    this.loadMonths();
  }

  aboutToDisappear(): void {
    this.lifecycle++;
    this.listRevision++;
    this.dayRevision++;
    this.calendarRevision++;
    this.searchRevision++;
    this.reads.invalidate();
    this.editor.onChange = () => {};
    this.editor.onDirty = () => {};
    this.editor.onFailure = () => {};
    this.editor.onReadyChange = () => {};
    this.editor.onCommand = () => {};
    this.editor.onImages = () => {};
    this.closeLink(false);
    this.onCaptureDraft(async () => undefined);
  }

  private isWide(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private message(error: Error): string {
    return error instanceof ApiError ? error.message : '服务器暂时无法读取日志';
  }

  private reportDraft(): void {
    this.onDraftChange(this.dirty && this.selectedDate ? {
      namespace: activeInstance.namespace, date: this.selectedDate, text: this.draftText
    } : undefined);
  }

  private async captureDraft(): Promise<PreservedLogDraft | undefined> {
    if (!this.selectedDate) return undefined;
    let text = this.draftText;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey === this.selectedDate) text = snapshot.text;
      } catch (_) { /* Keep the last observed draft if the editor is closing. */ }
    }
    return text !== this.savedText ? { namespace: activeInstance.namespace, date: this.selectedDate, text } : undefined;
  }

  private bodyFromDay(day: DayEntry): string {
    return day.content.trimEnd().replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, '')
      .replace(/^##\s+\d{4}-\d{2}-\d{2}[^\S\r\n]*\r?\n/, '').replace(/^\r?\n+/, '').trimEnd();
  }

  private confirmDiscard(next: () => void): void {
    if (this.leaveCheckPending) return;
    this.leaveCheckPending = true;
    this.checkBeforeLeaving(next).finally(() => this.leaveCheckPending = false);
  }

  private async checkBeforeLeaving(next: () => void): Promise<void> {
    if (this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) {
      this.saveError = '操作进行中，请稍候'; return;
    }
    if (this.day && this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.selectedDate) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    if (!this.dirty) { next(); return; }
    AlertDialog.show({ message: '当前日志修改尚未保存，是否放弃修改？', autoCancel: false,
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.dirty = false;
        this.reportDraft();
        next();
      } }
    });
  }

  private async switchMode(source: boolean, split: boolean = false): Promise<void> {
    if (source === this.sourceMode && split === this.splitMode) return;
    if (this.editorReady && this.day) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== this.selectedDate) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
        this.previewText = snapshot.text;
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '编辑器尚未就绪';
        return;
      }
    }
    this.sourceMode = source;
    this.splitMode = split;
  }

  private async save(): Promise<void> {
    if (!this.day || !this.editorReady || this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) return;
    const lifecycle = this.lifecycle;
    const revision = this.dayRevision;
    const date = this.day.date;
    this.saving = true;
    this.saveError = '';
    try {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== date || lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
      if (!this.dirty) return;
      const response = await this.writes.save({ date, content: snapshot.text, baseVersion: this.day.version });
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision || this.day?.date !== date) return;
      if (!response.day || response.day.date !== date || !response.day.version) throw new Error('保存响应格式异常');
      this.day = response.day;
      this.savedText = snapshot.text;
      this.dirty = this.draftText !== snapshot.text;
      this.reportDraft();
      this.previewText = this.draftText;
      this.reads.invalidate();
      this.refreshNavigation(date);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未覆盖。当前草稿仍保留，请先复制内容再刷新核对。' :
          error instanceof Error ? error.message : '保存失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.saving = false;
    }
  }

  private async refreshNavigation(date: string): Promise<void> {
    const lifecycle = this.lifecycle;
    const month = date.slice(0, 7);
    try {
      const result = await Promise.all([this.reads.months(), this.reads.days(month)]);
      if (lifecycle !== this.lifecycle) return;
      this.months = result[0].months;
      if (this.month === month && this.selectedDate === date) {
        this.days = result[1].days;
        this.navigationError = '';
      }
    } catch (error) {
      if (lifecycle === this.lifecycle && this.month === month && this.selectedDate === date) {
        this.navigationError = this.message(error as Error);
      }
    }
  }

  private async beforeRestore(): Promise<boolean> {
    if (!this.day || !this.backupOpen) return false;
    if (this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.selectedDate) return false;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
    }
    return new Promise<boolean>((resolve) => {
      AlertDialog.show({ title: '恢复此版本', autoCancel: false,
        message: `仅恢复 ${this.selectedDate} 日块，恢复前会再次保留现有文件。` +
          (this.dirty ? '\n当前编辑器有未保存修改，恢复会放弃这些修改。' : ''),
        primaryButton: { value: '取消', action: () => resolve(false) },
        secondaryButton: { value: '恢复', action: () => resolve(true) },
        cancel: () => resolve(false) });
    });
  }

  private applyRestoredDay(day: DayEntry): void {
    if (day.date !== this.selectedDate) return;
    this.day = day;
    const body = this.bodyFromDay(day);
    this.savedText = body;
    this.draftText = body;
    this.editorInitialText = body;
    this.previewText = body;
    this.dirty = false;
    this.reportDraft();
    this.sourceMode = false;
    this.splitMode = false;
    this.saveError = '';
    this.reads.invalidate();
    this.refreshNavigation(day.date);
    this.backupOpen = false;
  }

  private async openLink(): Promise<void> {
    if (!this.day || !this.editorReady || this.linkOpen || this.linkOpening || this.backupOpen) return;
    this.moreOpen = false;
    this.linkOpening = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    let target: EditorSnapshot | undefined = undefined;
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      target = await this.editor.command('capture');
      if (lifecycle !== this.lifecycle || target.documentKey !== date) return;
      await this.editor.command('blur');
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      this.linkTarget = target;
      this.linkAlias = target.text.slice(target.from, target.to);
      this.linkOpen = true;
      target = undefined;
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '无法打开内部链接';
    } finally {
      if (target) this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.linkOpening = false;
    }
  }

  private async insertLink(markup: string): Promise<void> {
    const target = this.linkTarget;
    if (!target || !this.linkOpen || target.documentKey !== this.selectedDate) throw new Error('插入位置已变化，请重新打开');
    await this.editor.insert(target, markup);
    this.closeLink();
  }

  private closeLink(refocus: boolean = true): void {
    this.linkOpen = false;
    const target = this.linkTarget;
    this.linkTarget = undefined;
    if (!target) return;
    this.editor.release(target).then(() => {
      if (refocus && this.editorReady && target.documentKey === this.selectedDate) {
        this.editor.command('focus').catch(() => {});
      }
    }).catch(() => {});
  }

  private imageUpload(): LogImageUpload {
    return new LogImageUpload(this.getUIContext().getHostContext() as common.UIAbilityContext);
  }

  private async insertImages(): Promise<void> {
    if (!this.day || !this.editorReady || this.imageBusy || this.linkOpen || this.backupOpen) return;
    this.moreOpen = false;
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    const uploader = this.imageUpload();
    let target: EditorSnapshot | undefined = undefined;
    let files: ApiUploadFile[] = [];
    try {
      if (!this.sourceMode && !this.splitMode) await this.switchMode(true);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate ||
        (!this.sourceMode && !this.splitMode)) return;
      target = await this.editor.command('capture');
      files = await uploader.pick();
      if (!files.length || lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      await this.editor.insert(target, markdown);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '图片插入失败';
    } finally {
      uploader.clear(files);
      if (target) this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private async receiveImages(target: EditorSnapshot, images: EditorImageData[]): Promise<void> {
    if (this.imageBusy || this.linkOpen || this.backupOpen || !this.day || target.documentKey !== this.selectedDate) {
      this.editor.release(target).catch(() => {});
      return;
    }
    this.imageBusy = true;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    const uploader = this.imageUpload();
    let files: ApiUploadFile[] = [];
    try {
      files = await uploader.paste(images);
      const markdown = await uploader.upload(files);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      await this.editor.insert(target, markdown);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '图片粘贴失败';
    } finally {
      uploader.clear(files);
      this.editor.release(target).catch(() => {});
      if (lifecycle === this.lifecycle) this.imageBusy = false;
    }
  }

  private exportName(scope: string, date: string): string {
    if (scope === 'day') return `${date}.zip`;
    if (scope === 'file') return `${date.slice(0, 7)}_学习日志.zip`;
    const today = new Date();
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `study-log-export-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}.zip`;
  }

  private async confirmSavedExport(): Promise<boolean> {
    if (this.day && this.editorReady) {
      const snapshot = await this.editor.command('snapshot');
      if (snapshot.documentKey !== this.selectedDate) return false;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
    }
    if (!this.dirty) return true;
    return new Promise<boolean>((resolve) => {
      AlertDialog.show({ title: '导出已保存内容？',
        message: '当前编辑器有未保存修改，导出内容将以已保存的 Markdown 文件为准。',
        primaryButton: { value: '取消', action: () => resolve(false) },
        secondaryButton: { value: '继续导出', action: () => resolve(true) },
        cancel: () => resolve(false) });
    });
  }

  private async exportLogs(scope: string): Promise<void> {
    this.moreOpen = false;
    this.exportMenuOpen = false;
    if (this.exportBusy || this.imageBusy || this.saving || this.deleting || this.linkOpen ||
      (scope !== 'all' && !this.selectedDate)) return;
    const lifecycle = this.lifecycle;
    const date = this.selectedDate;
    this.exportBusy = true;
    this.saveError = '';
    try {
      if (!await this.confirmSavedExport() || lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      const query = scope === 'all' ? '' : `&date=${encodeURIComponent(date)}`;
      const data = await apiClient.download(`/export?scope=${scope}${query}`);
      if (lifecycle !== this.lifecycle || date !== this.selectedDate) return;
      await saveExport(this.getUIContext().getHostContext() as common.UIAbilityContext,
        this.exportName(scope, date), data,
        () => lifecycle === this.lifecycle && date === this.selectedDate);
    } catch (error) {
      if (lifecycle === this.lifecycle) this.saveError = error instanceof Error ? error.message : '日志导出失败';
    } finally {
      if (lifecycle === this.lifecycle) this.exportBusy = false;
    }
  }

  private changeSearch(query: string): void {
    this.searchQuery = query;
    this.searchRevision++;
    this.searchLoading = false;
    this.searchSubmitted = false;
    this.searchResults = [];
    this.searchError = '';
  }

  private closeSearch(): void {
    this.searchOpen = false;
    this.searchRevision++;
    this.searchLoading = false;
  }

  private async searchLogs(): Promise<void> {
    const query = this.searchQuery.trim();
    if (!query || this.searchLoading) return;
    const revision = ++this.searchRevision;
    const lifecycle = this.lifecycle;
    this.searchLoading = true;
    this.searchSubmitted = true;
    this.searchError = '';
    this.searchResults = [];
    try {
      const response = await this.searches.search(query, this.searchHeadingsOnly, this.searchIgnoreCase);
      if (revision !== this.searchRevision || lifecycle !== this.lifecycle || !this.searchOpen) return;
      if (!Array.isArray(response.results)) throw new Error('搜索响应格式异常');
      this.searchResults = response.results;
    } catch (error) {
      if (revision === this.searchRevision && lifecycle === this.lifecycle && this.searchOpen) {
        this.searchError = error instanceof Error ? error.message : '搜索失败，请重试';
      }
    } finally {
      if (revision === this.searchRevision && lifecycle === this.lifecycle) this.searchLoading = false;
    }
  }

  private selectSearchResult(result: LogSearchResult): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date)) return;
    const heading = (result.matches[0] || '').replace(/^#{1,6}\s+/, '').replace(/^\d+\.\s+/, '').trim();
    this.confirmDiscard(() => {
      this.closeSearch();
      this.openInternalLink(result.date, result.headings.includes(heading) ? heading : '');
    });
  }

  private async confirmDelete(): Promise<void> {
    if (!this.day?.exists || !this.day.version || this.saving || this.deleting || this.backupOpen || this.linkOpen || this.imageBusy) return;
    this.moreOpen = false;
    const date = this.day.date;
    const version = this.day.version;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey !== date || this.day?.version !== version) return;
        this.draftText = snapshot.text;
        this.dirty = snapshot.text !== this.savedText;
        this.reportDraft();
      } catch (error) {
        this.saveError = error instanceof Error ? error.message : '请完成当前输入后重试';
        return;
      }
    }
    AlertDialog.show({
      message: this.dirty ? `确认删除 ${date} 日块？当前有未保存修改，删除会保留写入前备份。` :
        `确认删除 ${date} 日块？此操作会保留写入前备份。`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: { value: '删除', fontColor: $r('app.color.error'),
        action: () => { if (this.day?.date === date && this.day.version === version) this.deleteDay(date, version); } }
    });
  }

  private async deleteDay(date: string, version: string): Promise<void> {
    if (this.deleting || this.saving || this.backupOpen || this.linkOpen) return;
    const lifecycle = this.lifecycle;
    const revision = this.dayRevision;
    this.deleting = true;
    this.saveError = '';
    try {
      const response = await this.writes.delete({ date, baseVersion: version });
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision || this.day?.date !== date) return;
      if (!response.day || response.day.date !== date || response.day.exists) throw new Error('删除响应格式异常');
      this.day = response.day;
      const body = this.bodyFromDay(response.day);
      this.savedText = body;
      this.draftText = body;
      this.editorInitialText = body;
      this.previewText = body;
      this.dirty = false;
      this.reportDraft();
      this.sourceMode = false;
      this.splitMode = false;
      this.reads.invalidate();
      this.refreshNavigation(date);
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未删除。请刷新后核对。' : error instanceof Error ? error.message : '删除失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.deleting = false;
    }
  }

  private async loadMonths(): Promise<void> {
    const lifecycle = this.lifecycle;
    this.monthsLoading = true;
    this.errorMessage = '';
    try {
      const response = await this.reads.months();
      if (lifecycle !== this.lifecycle) return;
      if (!Array.isArray(response.months)) throw new Error('月份响应格式异常');
      this.months = response.months;
      const restoreDate = this.initialDraft?.namespace === activeInstance.namespace ? this.initialDraft.date : '';
      if (restoreDate || response.months.length > 0) {
        await this.loadDays(restoreDate ? restoreDate.slice(0, 7) : response.months[0].id, restoreDate);
      }
      else { this.month = ''; this.days = []; this.day = undefined; this.selectedDate = ''; }
    } catch (error) {
      if (lifecycle === this.lifecycle) this.errorMessage = this.message(error as Error);
    } finally {
      if (lifecycle === this.lifecycle) this.monthsLoading = false;
    }
  }

  private async loadDays(month: string, targetDate: string = ''): Promise<void> {
    const lifecycle = this.lifecycle;
    const revision = ++this.listRevision;
    this.dayRevision++;
    this.month = month;
    this.days = [];
    this.day = undefined;
    this.selectedDate = '';
    this.daysLoading = true;
    this.navigationError = '';
    try {
      const response = await this.reads.days(month);
      if (lifecycle !== this.lifecycle || revision !== this.listRevision) return;
      if (!Array.isArray(response.days)) throw new Error('日期响应格式异常');
      this.days = response.days;
      if (targetDate) await this.loadDay(targetDate);
      else if (response.days.length > 0) await this.loadDay(response.days[0].date);
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.listRevision) {
        this.navigationError = this.message(error as Error);
        this.errorMessage = this.navigationError;
      }
    } finally {
      if (lifecycle === this.lifecycle && revision === this.listRevision) this.daysLoading = false;
    }
  }

  private async loadDay(date: string, heading: string = '', headingIndex: number = -1): Promise<void> {
    const lifecycle = this.lifecycle;
    const revision = ++this.dayRevision;
    this.dayLoading = true;
    this.errorMessage = '';
    this.day = undefined;
    this.editorReady = false;
    this.dirty = false;
    this.selectedDate = date;
    try {
      const response = await this.reads.day(date);
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      if (!response.day || response.day.date !== date || typeof response.day.content !== 'string') {
        throw new Error('日块响应格式异常');
      }
      this.day = response.day;
      const body = this.bodyFromDay(response.day);
      const restore = !this.restoredDraftApplied && this.initialDraft?.namespace === activeInstance.namespace &&
        this.initialDraft.date === date ? this.initialDraft : undefined;
      if (restore) this.restoredDraftApplied = true;
      this.savedText = body;
      this.draftText = restore ? restore.text : body;
      this.editorInitialText = this.draftText;
      this.previewText = this.draftText;
      this.dirty = this.draftText !== body;
      this.reportDraft();
      this.saveError = '';
      this.targetHeading = heading;
      this.targetHeadingIndex = headingIndex;
      if (heading) this.targetRevision++;
      this.navigationOpen = false;
    } catch (error) {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.errorMessage = this.message(error as Error);
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.dayLoading = false;
    }
  }

  private async openInternalLink(date: string, heading: string): Promise<void> {
    if (date.slice(0, 7) !== this.month) {
      await this.loadDays(date.slice(0, 7), date);
      if (this.day?.date !== date) return;
    } else if (date !== this.selectedDate) {
      await this.loadDay(date);
      if (this.day?.date !== date) return;
    }
    this.targetHeading = heading;
    this.targetHeadingIndex = -1;
    this.targetRevision++;
  }

  private calendarDate(value: Date): string {
    return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
  }

  private openCalendar(mode: string): void {
    this.calendarMode = mode;
    if (!this.newLogDate) this.newLogDate = this.calendarDate(new Date());
    this.calendarMonth = (mode === 'jump' ? this.selectedDate || this.newLogDate : this.newLogDate).slice(0, 7);
    this.calendarOpen = true;
    this.loadCalendar();
  }

  private async loadCalendar(): Promise<void> {
    const revision = ++this.calendarRevision;
    this.calendarLoading = true;
    this.calendarError = false;
    this.calendarDates = [];
    try {
      const response = await this.reads.days(this.calendarMonth);
      if (revision === this.calendarRevision) this.calendarDates = response.days.map((day: DaySummary) => day.date);
    } catch (_) {
      if (revision === this.calendarRevision) this.calendarError = true;
    } finally {
      if (revision === this.calendarRevision) this.calendarLoading = false;
    }
  }

  private shiftCalendar(offset: number): void {
    const parts = this.calendarMonth.split('-');
    this.calendarMonth = this.calendarDate(new Date(Number(parts[0]), Number(parts[1]) - 1 + offset, 1)).slice(0, 7);
    this.loadCalendar();
  }

  private calendarCells(): string[] {
    if (!this.calendarMonth) return [];
    const parts = this.calendarMonth.split('-');
    const first = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    const count = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    const cells: string[] = [];
    for (let index = 0; index < (first.getDay() + 6) % 7; index++) cells.push('');
    for (let day = 1; day <= count; day++) cells.push(`${this.calendarMonth}-${day.toString().padStart(2, '0')}`);
    return cells;
  }

  private canSelectCalendarDate(date: string): boolean {
    return !!date && date <= this.calendarDate(new Date()) &&
      (this.calendarMode === 'create' || (!this.calendarLoading && !this.calendarError && this.calendarDates.includes(date)));
  }

  private selectCalendarDate(date: string): void {
    if (!this.canSelectCalendarDate(date)) return;
    this.calendarOpen = false;
    if (this.calendarMode === 'jump') this.confirmDiscard(() => this.openDate(date, false));
    else this.newLogDate = date;
  }

  private async openDate(date: string, edit: boolean): Promise<void> {
    if (date.slice(0, 7) === this.month) await this.loadDay(date);
    else await this.loadDays(date.slice(0, 7), date);
    if (edit && this.day?.date === date) { this.sourceMode = true; this.splitMode = false; }
  }

  private openNewLog(date: string): void {
    this.calendarOpen = false;
    this.confirmDiscard(() => this.openDate(date, true));
  }

  @Builder
  private logCalendar() {
    Column({ space: 8 }) {
      Text(this.calendarMode === 'jump' ? '跳转到日期' : '选择新建日期')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
      Row() {
        Button('‹', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .accessibilityText('上一个月').onClick(() => this.shiftCalendar(-1))
        Text(this.calendarMonth).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Center)
        Button('›', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .enabled(this.calendarMonth < this.calendarDate(new Date()).slice(0, 7))
          .accessibilityText('下一个月').onClick(() => this.shiftCalendar(1))
      }.width('100%')
      Row() {
        ForEach(['一', '二', '三', '四', '五', '六', '日'], (day: string) => {
          Text(day).width('14.2857%').textAlign(TextAlign.Center).fontSize(12).fontColor($r('app.color.muted'))
        })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.calendarCells(), (date: string, index: number) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 2 }) {
              Text(date ? Number(date.slice(-2)).toString() : '').fontSize(13)
                .fontColor(this.canSelectCalendarDate(date) ? $r('app.color.ink') : $r('app.color.muted_soft'))
              Circle().width(3).height(3).fill(this.calendarDates.includes(date) ? $r('app.color.primary') : Color.Transparent)
            }
          }
          .id(`log_calendar_day_${date || index}`).width('14.2857%').height(36).padding(0)
          .backgroundColor(date && date === (this.calendarMode === 'jump' ? this.selectedDate : this.newLogDate) ?
            $r('app.color.surface_card') : Color.Transparent)
          .borderRadius(6).enabled(this.canSelectCalendarDate(date))
          .accessibilityText(date).onClick(() => this.selectCalendarDate(date))
        }, (date: string, index: number) => `${date}:${index}`)
      }.width('100%')
      if (this.calendarError) {
        Button('读取失败，点击重试', { type: ButtonType.Normal }).fontSize(12)
          .fontColor($r('app.color.muted')).backgroundColor(Color.Transparent).onClick(() => this.loadCalendar())
      } else {
        Text(this.calendarLoading ? '正在读取日志日期…' :
          this.calendarMode === 'jump' ? '有记录的日期可直接跳转' : '选定日期后，点击“新建”打开日块')
          .fontSize(12).fontColor($r('app.color.muted'))
      }
    }.width(280).padding(14)
  }

  @Builder
  private dateActions() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([$r('app.color.ink')])
          Text('今天').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.justifyContent(FlexAlign.Center)
      }
      .width('100%').height(40).padding(0).margin({ bottom: 8 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      .onClick(() => this.openNewLog(this.calendarDate(new Date())))
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.ink')])
            Text(this.newLogDate || this.calendarDate(new Date())).fontSize(13)
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          }.justifyContent(FlexAlign.Center)
        }
        .layoutWeight(1).height(40).padding(0).backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .id('log_create_date_picker').accessibilityText('选择新建日期')
        .onClick(() => this.openCalendar('create'))
        .bindPopup(this.calendarOpen && this.calendarMode === 'create', {
          builder: this.logCalendar(), placement: Placement.Bottom, enableArrow: false,
          popupColor: $r('app.color.canvas'), radius: 8,
          onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'create') this.calendarOpen = false; }
        })
        Button('+ 新建', { type: ButtonType.Normal }).height(40).padding({ left: 10, right: 10 })
          .fontSize(13).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .id('log_create_date_submit').onClick(() => this.openNewLog(this.newLogDate || this.calendarDate(new Date())))
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private jumpDatePicker() {
    Button({ type: ButtonType.Normal }) {
      SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
    }.width(28).height(28).padding(0).backgroundColor(Color.Transparent)
      .id('log_jump_date_picker').accessibilityText('跳转到指定日期')
      .onClick(() => this.openCalendar('jump'))
      .bindPopup(this.calendarOpen && this.calendarMode === 'jump', {
        builder: this.logCalendar(), placement: Placement.BottomRight, enableArrow: false,
        popupColor: $r('app.color.canvas'), radius: 8,
        onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'jump') this.calendarOpen = false; }
      })
  }

  private openHeading(day: DaySummary, heading: string, index: number): void {
    if (this.day?.date === day.date) {
      this.targetHeading = heading;
      this.targetHeadingIndex = index;
      this.targetRevision++;
      this.navigationOpen = false;
    } else this.confirmDiscard(() => this.loadDay(day.date, heading, index));
  }

  @Builder
  private navigation() {
    Column() {
      LogNavigation({ navigationMonths: this.months, navigationDays: this.days,
        navigationMonth: this.month, requestedDate: this.selectedDate,
        navigationMonthsExpanded: this.navigationMonthsExpanded,
        navigationDayQuery: this.navigationDayQuery,
        navigationLoading: this.monthsLoading || this.daysLoading,
        navigationError: this.navigationError,
        dateActions: (): void => this.dateActions(),
        jumpDatePicker: (): void => this.jumpDatePicker(),
        onMonth: (month: string) => { if (month !== this.month) this.confirmDiscard(() => this.loadDays(month)); },
        onDay: (date: string) => { if (date !== this.selectedDate) this.confirmDiscard(() => this.loadDay(date)); },
        onHeading: (day: DaySummary, heading: string, index: number) => this.openHeading(day, heading, index),
        onQuery: (query: string) => this.navigationDayQuery = query,
        onToggleMonths: () => this.navigationMonthsExpanded = !this.navigationMonthsExpanded,
        onRetry: () => this.month ? this.loadDays(this.month) : this.loadMonths() })
    }
    .width('100%').height('100%')
    .backgroundColor($r('app.color.canvas'))
  }

  @Builder
  private moreActions() {
    Column({ space: 4 }) {
      Button('导出当前日块', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('day'))
      Button('导出当前源文件', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('file'))
      Button('导出全部日志', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!this.exportBusy).onClick(() => this.exportLogs('all'))
      Button(this.imageBusy ? '上传中' : '插入图片', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && this.editorReady && !this.imageBusy).onClick(() => this.insertImages())
      if (this.sourceMode || this.splitMode) {
        Button('内部链接', { type: ButtonType.Normal }).width('100%').height(40)
          .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .enabled(this.editorReady && !this.linkOpening).onClick(() => this.openLink())
      }
      Button('备份与恢复', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.saving && !this.deleting)
        .onClick(() => { this.moreOpen = false; this.backupOpen = true; })
      Button('删除日块', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.error')).backgroundColor(Color.Transparent)
        .enabled(!!this.day?.exists && !this.saving && !this.deleting)
        .onClick(() => this.confirmDelete())
    }.width(170).padding(8)
  }

  @Builder
  private exportActions() {
    Column({ space: 4 }) {
      Button('当前日块', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('day'))
      Button('当前源文件', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!!this.day && !this.exportBusy).onClick(() => this.exportLogs('file'))
      Button('全部日志', { type: ButtonType.Normal }).width('100%').height(40)
        .fontSize(13).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
        .enabled(!this.exportBusy).onClick(() => this.exportLogs('all'))
    }.width(150).padding(8)
  }

  @Builder
  private editorActions() {
    Row({ space: 6 }) {
      Button('浏览').fontSize(13)
        .fontColor(!this.sourceMode && !this.splitMode ? $r('app.color.ink') : $r('app.color.muted'))
        .backgroundColor(!this.sourceMode && !this.splitMode ? $r('app.color.surface_card') : $r('app.color.surface_soft'))
        .onClick(() => this.switchMode(false))
      Button('源码').fontSize(13)
        .fontColor(this.sourceMode || this.splitMode && !this.isWide() ? $r('app.color.ink') : $r('app.color.muted'))
        .backgroundColor(this.sourceMode || this.splitMode && !this.isWide() ?
          $r('app.color.surface_card') : $r('app.color.surface_soft'))
        .onClick(() => this.switchMode(true))
      if (this.isWide()) {
        Button('分屏').fontSize(13)
          .fontColor(this.splitMode ? $r('app.color.ink') : $r('app.color.muted'))
          .backgroundColor(this.splitMode ? $r('app.color.surface_card') : $r('app.color.surface_soft'))
          .onClick(() => this.switchMode(false, true))
      }
      Button(this.saving ? '保存中' : '保存').fontSize(13)
        .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
        .enabled(this.editorReady && this.dirty && !this.saving)
        .onClick(() => this.save())
      if (this.isWide() && this.headerWidth >= 760) {
        Button('导出').fontSize(13)
          .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .enabled(!this.exportBusy).onClick(() => this.exportMenuOpen = true)
          .bindPopup(this.exportMenuOpen, { builder: this.exportActions(), placement: Placement.BottomRight,
            enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
            onStateChange: (event) => { if (!event.isVisible) this.exportMenuOpen = false; } })
        Button(this.imageBusy ? '上传中' : '插入图片').fontSize(13)
          .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .enabled(!!this.day && this.editorReady && !this.imageBusy).onClick(() => this.insertImages())
        if (this.sourceMode || this.splitMode) {
          Button('内部链接').fontSize(13)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .enabled(this.editorReady && !this.linkOpening).onClick(() => this.openLink())
        }
        Button('备份').fontSize(13)
          .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .enabled(!!this.day && !this.saving && !this.deleting)
          .onClick(() => this.backupOpen = true)
        Button(this.deleting ? '删除中' : '删除').fontSize(13)
          .fontColor($r('app.color.error')).backgroundColor($r('app.color.surface_soft'))
          .enabled(!!this.day?.exists && !this.saving && !this.deleting)
          .onClick(() => this.confirmDelete())
      } else {
        Button('更多', { type: ButtonType.Normal }).fontSize(13)
          .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .onClick(() => this.moreOpen = true)
          .bindPopup(this.moreOpen, { builder: this.moreActions(), placement: Placement.BottomRight,
            enableArrow: false, popupColor: $r('app.color.canvas'), radius: 8,
            onStateChange: (event) => { if (!event.isVisible) this.moreOpen = false; } })
      }
    }
  }

  @Builder
  private heading() {
    if (this.isWide()) {
      DesktopLogHeader({ fileName: this.day?.fileName || '', selectedDate: this.selectedDate,
        workspaceBreakpoint: this.workspaceBreakpoint,
        toolbarWidth: this.headerWidth, dateWidth: this.headerDateWidth,
        actions: (): void => this.editorActions(),
        onWidth: (width: number) => this.headerWidth = width,
        onDateWidth: (width: number) => this.headerDateWidth = Math.max(120, width) })
    } else {
      Row() {
        Text(this.selectedDate)
          .fontFamily(workspaceDateFamily(this.workspaceBreakpoint)).fontSize(24).fontWeight(600)
          .fontColor($r('app.color.ink')).layoutWeight(1)
        this.editorActions()
      }.height(60).width('100%').padding({ left: 16, right: 16 })
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
    }
  }

  @Builder
  private reader() {
    Column() {
      this.heading()
      if (this.monthsLoading || this.daysLoading || this.dayLoading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在加载日志').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.errorMessage) {
        LoadFailure({ message: this.errorMessage,
          onRetry: () => this.month ? this.selectedDate ? this.loadDay(this.selectedDate) : this.loadDays(this.month) :
            this.loadMonths() })
      } else if (this.day) {
        Stack({ alignContent: Alignment.Bottom }) {
          Row() {
            SourceEditor({ session: this.editor, documentKey: this.day.date,
              initialText: this.editorInitialText })
              .width(this.isWide() && this.splitMode ? '50%' : (this.sourceMode || this.splitMode ? '100%' : 0))
              .height('100%')
              .visibility(this.sourceMode || this.splitMode ? Visibility.Visible : Visibility.None)
              .border({ width: { right: this.isWide() && this.splitMode ? 1 : 0 },
                color: $r('app.color.hairline') })
            MarkdownReader({ content: this.previewText, contentMode: 'log', documentKey: this.day.date,
              targetHeading: this.targetHeading, targetHeadingIndex: this.targetHeadingIndex,
              targetRevision: this.targetRevision,
              onInternalLink: (date: string, heading: string) => this.confirmDiscard(() => this.openInternalLink(date, heading)) })
              .width(this.isWide() && this.splitMode ? '50%' : (this.sourceMode || this.splitMode && !this.isWide() ? 0 : '100%'))
              .height('100%')
              .visibility(this.sourceMode || this.splitMode && !this.isWide() ? Visibility.None : Visibility.Visible)
          }.width('100%').height('100%')
          if (this.saveError) {
            Text(this.saveError).fontSize(13).fontColor($r('app.color.error'))
              .width('100%').padding(12).backgroundColor($r('app.color.surface_soft'))
          }
        }.layoutWeight(1).width('100%')
      } else {
        EmptyState({ title: '暂无学习日志', description: '当前实例还没有可阅读的日志。' })
      }
    }.layoutWeight(1).height('100%')
  }

  build() {
    Stack() {
      Column() {
        Row({ space: 8 }) {
          if (!this.isWide()) {
            Button({ type: ButtonType.Normal }) {
              SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(20).fontColor([$r('app.color.ink')])
            }.width(42).height(42).backgroundColor(Color.Transparent).accessibilityText('打开日期导航')
              .onClick(() => this.navigationOpen = true)
          }
          AppLogo({ iconSize: 28, cornerRadius: 6 })
          Text('学习日志工作台').fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).layoutWeight(1)
          Button('搜索').fontSize(13).fontColor($r('app.color.body'))
            .backgroundColor($r('app.color.surface_soft'))
            .onClick(() => this.searchOpen = true)
          Button('更换服务器').fontSize(13).fontColor($r('app.color.body'))
            .backgroundColor($r('app.color.surface_soft'))
            .enabled(!this.backupOpen && !this.linkOpen)
            .onClick(() => this.confirmDiscard(() => this.onChangeServer()))
        }.width('100%').height(54).padding({ left: 12, right: 12 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        Stack() {
          Row() {
            if (this.isWide()) {
              Column() { this.navigation() }.width(260).height('100%')
                .border({ width: { right: 1 }, color: $r('app.color.hairline') })
            }
            this.reader()
          }.width('100%').height('100%')
          if (!this.isWide() && this.navigationOpen) {
            Row() {
              Column() {
                Row() {
                  Text('日期').fontSize(16).fontColor($r('app.color.ink')).layoutWeight(1)
                  Button('关闭').fontSize(13).onClick(() => this.navigationOpen = false)
                }.height(48).padding({ left: 16, right: 16 })
                this.navigation()
              }.width('86%').height('100%')
                .backgroundColor($r('app.color.canvas'))
              Blank().layoutWeight(1).height('100%').onClick(() => this.navigationOpen = false)
            }.width('100%').height('100%').backgroundColor($r('app.color.scrim'))
          }
        }.layoutWeight(1).width('100%')
      }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      if (this.backupOpen && this.day) {
        Stack() {
          Column() {}.width('100%').height('100%').backgroundColor($r('app.color.scrim'))
          BackupPanel({ date: this.day.date,
            onClose: () => { if (!this.backupBusy) this.backupOpen = false; },
            onBeforeRestore: () => this.beforeRestore(),
            onRestored: (day: DayEntry) => this.applyRestoredDay(day),
            onBusyChange: (busy: boolean) => this.backupBusy = busy })
            .width(this.isWide() ? '88%' : '100%')
            .height(this.isWide() ? '88%' : '100%')
            .borderRadius(this.isWide() ? 12 : 0)
            .clip(true)
        }.width('100%').height('100%')
      }
      if (this.linkOpen) {
        Stack() {
          Column() {}.width('100%').height('100%').backgroundColor($r('app.color.scrim'))
          EditorLinkPicker({ initialAlias: this.linkAlias,
            onClose: () => this.closeLink(),
            onInsert: (markup: string) => this.insertLink(markup) })
            .width(this.isWide() ? 680 : '100%')
            .height(this.isWide() ? 620 : '100%')
            .borderRadius(this.isWide() ? 12 : 0).clip(true)
        }.width('100%').height('100%')
      }
      if (this.searchOpen) {
        LogSearchPanel({ query: this.searchQuery, headingsOnly: this.searchHeadingsOnly,
          ignoreCase: this.searchIgnoreCase, loading: this.searchLoading,
          submitted: this.searchSubmitted, error: this.searchError, results: this.searchResults,
          onClose: () => this.closeSearch(), onQuery: (query: string) => this.changeSearch(query),
          onSearch: () => this.searchLogs(),
          onHeadings: () => { this.searchHeadingsOnly = !this.searchHeadingsOnly; this.changeSearch(this.searchQuery); },
          onCase: () => { this.searchIgnoreCase = !this.searchIgnoreCase; this.changeSearch(this.searchQuery); },
          onSelect: (result: LogSearchResult) => this.selectSearchResult(result) })
          .width('100%').height('100%')
      }
    }.width('100%').height('100%')
  }
}

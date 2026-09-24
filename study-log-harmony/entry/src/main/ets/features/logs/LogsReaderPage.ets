import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { apiClient, ApiError } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { EmptyState, LoadFailure } from '../../common/ui/FeedbackStates';
import { MarkdownReader } from '../../common/ui/MarkdownReader';
import { workspaceDateFamily, workspaceSansFamily } from '../../common/ui/Typography';
import { AppLogo } from '../../common/ui/AppLogo';
import { SourceEditor, SourceEditorSession, EditorSnapshot } from '../../common/editor/SourceEditor';
import { DayEntry, DaySummary, MonthSummary } from './LogModels';
import { LogReadRepository } from './LogReadRepository';
import { LogWriteRepository } from './LogWriteRepository';
import { LogNavigation } from './components/LogNavigation';
import { DesktopLogHeader } from './components/DesktopLogHeader';

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
  @State private headerWidth: number = 900;
  @State private headerDateWidth: number = 190;
  @State private sourceMode: boolean = false;
  @State private editorReady: boolean = false;
  @State private draftText: string = '';
  @State private editorInitialText: string = '';
  @State private previewText: string = '';
  @State private savedText: string = '';
  @State private dirty: boolean = false;
  @State private saving: boolean = false;
  @State private saveError: string = '';
  private reads: LogReadRepository = new LogReadRepository(apiClient);
  private writes: LogWriteRepository = new LogWriteRepository(apiClient);
  private editor: SourceEditorSession = new SourceEditorSession();
  private lifecycle: number = 0;
  private listRevision: number = 0;
  private dayRevision: number = 0;
  private restoredDraftApplied: boolean = false;

  aboutToAppear(): void {
    this.lifecycle++;
    this.onCaptureDraft(() => this.captureDraft());
    this.editor.onReadyChange = (ready: boolean) => this.editorReady = ready;
    this.editor.onChange = (snapshot: EditorSnapshot) => {
      if (snapshot.documentKey !== this.selectedDate) return;
      this.draftText = snapshot.text;
      this.dirty = snapshot.text !== this.savedText;
      this.reportDraft();
    };
    this.editor.onDirty = (key: string) => {
      if (key === this.selectedDate) { this.dirty = true; this.reportDraft(); }
    };
    this.editor.onFailure = (message: string) => this.saveError = message;
    this.loadMonths();
  }

  aboutToDisappear(): void {
    this.lifecycle++;
    this.listRevision++;
    this.dayRevision++;
    this.reads.invalidate();
    this.editor.onChange = () => {};
    this.editor.onDirty = () => {};
    this.editor.onFailure = () => {};
    this.editor.onReadyChange = () => {};
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
    if (!this.dirty || !this.selectedDate) return undefined;
    let text = this.draftText;
    if (this.editorReady) {
      try {
        const snapshot = await this.editor.command('snapshot');
        if (snapshot.documentKey === this.selectedDate) text = snapshot.text;
      } catch (_) { /* Keep the last observed draft if the editor is closing. */ }
    }
    return { namespace: activeInstance.namespace, date: this.selectedDate, text };
  }

  private bodyFromDay(day: DayEntry): string {
    return day.content.trimEnd().replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, '')
      .replace(/^##\s+\d{4}-\d{2}-\d{2}[^\S\r\n]*\r?\n/, '').replace(/^\r?\n+/, '').trimEnd();
  }

  private confirmDiscard(next: () => void): void {
    if (this.saving) { this.saveError = '保存进行中，请稍候'; return; }
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

  private async switchMode(source: boolean): Promise<void> {
    if (source === this.sourceMode) return;
    if (!source && this.editorReady && this.day) {
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
  }

  private async save(): Promise<void> {
    if (!this.day || !this.editorReady || this.saving || !this.dirty) return;
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
      const response = await this.writes.save({ date, content: snapshot.text, baseVersion: this.day.version });
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision || this.day?.date !== date) return;
      if (!response.day || response.day.date !== date || !response.day.version) throw new Error('保存响应格式异常');
      this.day = response.day;
      this.savedText = snapshot.text;
      this.dirty = this.draftText !== snapshot.text;
      this.reportDraft();
      this.previewText = this.draftText;
      this.reads.invalidate();
    } catch (error) {
      if (lifecycle !== this.lifecycle || revision !== this.dayRevision) return;
      this.saveError = error instanceof ApiError && error.statusCode === 409 ?
        '源文件已变化，未覆盖。当前草稿仍保留，请先复制内容再刷新核对。' :
          error instanceof Error ? error.message : '保存失败，请重试';
    } finally {
      if (lifecycle === this.lifecycle && revision === this.dayRevision) this.saving = false;
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
  private editorActions() {
    Row({ space: 6 }) {
      Button('浏览').fontSize(13)
        .fontColor(!this.sourceMode ? $r('app.color.ink') : $r('app.color.muted'))
        .backgroundColor(!this.sourceMode ? $r('app.color.surface_card') : $r('app.color.surface_soft'))
        .onClick(() => this.switchMode(false))
      Button('源码').fontSize(13)
        .fontColor(this.sourceMode ? $r('app.color.ink') : $r('app.color.muted'))
        .backgroundColor(this.sourceMode ? $r('app.color.surface_card') : $r('app.color.surface_soft'))
        .onClick(() => this.switchMode(true))
      Button(this.saving ? '保存中' : '保存').fontSize(13)
        .fontColor($r('app.color.on_primary')).backgroundColor($r('app.color.primary'))
        .enabled(this.editorReady && this.dirty && !this.saving)
        .onClick(() => this.save())
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
              .width(this.sourceMode ? '100%' : 0).height('100%')
              .visibility(this.sourceMode ? Visibility.Visible : Visibility.None)
            MarkdownReader({ content: this.previewText, contentMode: 'log', documentKey: this.day.date,
              targetHeading: this.targetHeading, targetHeadingIndex: this.targetHeadingIndex,
              targetRevision: this.targetRevision,
              onInternalLink: (date: string, heading: string) => this.confirmDiscard(() => this.openInternalLink(date, heading)) })
              .width(this.sourceMode ? 0 : '100%').height('100%')
              .visibility(this.sourceMode ? Visibility.None : Visibility.Visible)
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
        Button('更换服务器').fontSize(13).fontColor($r('app.color.body'))
          .backgroundColor($r('app.color.surface_soft'))
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
  }
}

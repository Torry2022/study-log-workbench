import { appFeedback, FeedbackTone } from '../../common/ui/AppFeedback';
import { MODULE_HEADER_LEFT_INSET } from '../../common/ui/WorkspaceChrome';
import { iconTint } from '../../common/ui/IconTint';
import { BackToTopControl } from '../../common/ui/BackToTopControl';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { ModulePageTitle, ModuleLogButton } from '../../common/ui/WorkspaceChrome';
import { SearchField } from '../../common/ui/FormControls';
import { common } from '@kit.AbilityKit';
import { saveExport } from '../../common/files/DocumentExport';
import { apiClient } from '../../common/network/ApiClient';
import { NoteEditorFields } from './components/NoteEditorFields';
import { NoteRecordedAt } from './components/NoteRecordedAt';
import { NoteMarkdownText } from './components/NoteMarkdownText';
import { ToolbarAction } from '../../common/ui/ToolbarAction';
import { toolbarActionsWidth } from '../../common/ui/ToolbarLayout';
import { secondaryPageTransition, ResultChangeGate } from '../../common/ui/WorkspaceMotion';
import { ResultSurfaceController, ResultSurfaceCover } from '../../common/ui/ResultSurface';
import { ContentLoadingState } from '../../common/ui/ContentLoadingState';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import { WorkspaceBreakpoint, READING_MAX_WIDTH } from '../../common/AppConfig';
import { workspaceSerifFamily } from '../../common/ui/Typography';
import { StudyNote, StudyNoteFacet } from './NoteModels';
import { NoteEditorSession } from './NoteEditorSession';
import { NotesController } from './NotesController';

@Component
export struct NotesPage {
  @StorageProp('pref_readingScale') private readingScale: number = 1;
  @Prop @Watch('topRequested') topRevision: number = 0;

  private topRequested(): void {
    if (this.topRevision > 0 && !this.noteEditor.editing) this.scrollToTop();
  }
  onLoadingHintChange: (placement: LoadingHintPlacement) => void = () => {};
  @State private toolbarLabels: boolean = false;
  @State private headerWidth: number = 0;
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop @Watch('navigationFilterChanged') navigationYear: string = 'all';
  @Prop @Watch('navigationFilterChanged') navigationTag: string = 'all';
  @Prop @Watch('navigationNewRevisionChanged') navigationNewRevision: number = 0;
  @Prop searchRevision: number = 0;
  @Prop @Watch('saveRequested') saveRevision: number = 0;
  onNavigationDataChange: (years: StudyNoteFacet[], tags: StudyNoteFacet[], total: number) => void = () => {};
  onScrollStateChange: (scrolled: boolean) => void = () => {};
  onOpenLog: () => void = () => {};
  onEditorBusyChange: (busy: boolean) => void = () => {};
  onDirtyChange: (dirty: boolean) => void = () => {};
  onInternalLink: (date: string, heading: string) => void = () => {};
  @State private visibleNotes: StudyNote[] = [];
  @State private query: string = '';
  @State private resultSurface: ResultSurfaceController = new ResultSurfaceController();
  @State private imageUploading: boolean = false;
  @State private highlightedNoteId: string = '';
  @State private scrollOffset: number = 0;
  @State private scrollProgress: number = 0;
  @State private noteViewportHeight: number = 0;
  @State private topToolsHeight: number = 0;
  private noteScroller: Scroller = new Scroller();
  private resultChanges: ResultChangeGate = new ResultChangeGate();
  private editorScroller: Scroller = new Scroller();
  private editorScrollOffset: number = 0;
  private editorUserScrolling: boolean = false;
  private noteHeights: Map<string, number> = new Map<string, number>();

  @State private noteEditor: NoteEditorSession = new NoteEditorSession();
  @State private data: NotesController = new NotesController(apiClient, this.noteEditor, {
    blocked: () => false,
    uploading: () => this.imageUploading,
    navigationChanged: (years, tags, total) => this.onNavigationDataChange(years, tags, total),
    loaded: () => this.applyFilter(),
    success: (message) => { this.showToast(message); this.reportDirty(); },
    failure: (message) => this.showToast(message, 'error')
  });

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private scrollToTop(): void {
    this.noteScroller.scrollToIndex(0, true, ScrollAlign.START);
  }

  private updateNoteScrollProgress(): void {
    this.scrollOffset = Math.max(0, this.noteScroller.currentOffset().yOffset);
    let measuredHeight = 0;
    let measuredCount = 0;
    this.visibleNotes.forEach((note: StudyNote) => {
      const height = this.noteHeights.get(note.id) || 0;
      if (height > 0) {
        measuredHeight += height;
        measuredCount += 1;
      }
    });
    const averageHeight = measuredCount > 0 ? measuredHeight / measuredCount : this.noteViewportHeight;
    const estimatedContentHeight = this.topToolsHeight + measuredHeight +
      averageHeight * (this.visibleNotes.length - measuredCount);
    const scrollableHeight = Math.max(1, estimatedContentHeight - this.noteViewportHeight);
    this.scrollProgress = Math.min(1, Math.max(0, this.scrollOffset / scrollableHeight));
    this.onScrollStateChange(this.topToolsHeight > 0 && this.scrollOffset >= this.topToolsHeight - 0.5);
  }

  aboutToAppear(): void {
    this.load();
  }

  private navigationFilterChanged(): void {
    this.applyFilter();
  }

  private navigationNewRevisionChanged(): void {
    if (this.navigationNewRevision <= 0 || this.data.saving || this.imageUploading) return;
    if (!this.noteEditor.editing || this.editorValue() === this.noteEditor.baseline) {
      this.startNew();
      return;
    }
    AlertDialog.show({
      message: '当前随记尚未保存，确认新建吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: {
        value: '放弃并新建',
        fontColor: $r('app.color.error'),
        action: () => this.startNew()
      }
    });
  }


  private async load(): Promise<void> { await this.data.load(); }

  private applyFilter(): void {
    const visible = this.data.filtered(this.navigationYear, this.navigationTag, this.query);
    const key = visible.map((note: StudyNote) => note.id).join('|');
    if (this.data.loading) {
      this.resultSurface.clear();
      this.visibleNotes = visible;
      this.resultChanges.reset(key);
    }
    else this.resultChanges.update(key, (isCurrent: () => boolean) => {
      this.resultSurface.replace(this.getUIContext(), 'notes_result_surface', () => {
        this.visibleNotes = visible;
        if (visible.length > 0) this.noteScroller.scrollToIndex(0, false, ScrollAlign.START);
        this.scrollOffset = 0;
        this.scrollProgress = 0;
        this.onScrollStateChange(false);
      }, isCurrent);
    });
    if (key === this.visibleNotes.map((note: StudyNote) => note.id).join('|')) this.visibleNotes = visible;
  }

  aboutToDisappear(): void {
    this.data.dispose();
    this.noteEditor.revision += 1;
    this.resultChanges.reset('');
    this.resultSurface.clear();
  }

  private localTimestamp(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00+08:00`;
  }

  private startNew(): void {
    this.noteEditor.startNew(this.localTimestamp());
    this.reportDirty();
    this.data.errorMessage = '';
    this.editorScrollOffset = 0;
    const revision = this.noteEditor.revision;
    setTimeout((): void => {
      if (revision === this.noteEditor.revision) this.editorScroller.scrollTo({ xOffset: 0, yOffset: 0 });
    }, 0);
  }

  private startEdit(note: StudyNote): void {
    this.noteEditor.startEdit(note);
    this.reportDirty();
    this.data.errorMessage = '';
    this.editorScrollOffset = 0;
    const revision = this.noteEditor.revision;
    setTimeout((): void => {
      if (revision === this.noteEditor.revision) this.editorScroller.scrollTo({ xOffset: 0, yOffset: 0 });
    }, 0);
  }



  private async save(): Promise<void> { await this.data.save(); }

  private saveRequested(): void {
    if (this.saveRevision > 0 && this.noteEditor.editing && !this.data.saving && !this.imageUploading) this.save();
  }

  private confirmDelete(note: StudyNote): void {
    if (this.data.deletingId) return;
    const generation = this.data.generation();
    AlertDialog.show({
      message: `确认删除随记“${note.displayTitle}”吗？删除后可从服务器写入前备份中恢复。`,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '删除',
        fontColor: $r('app.color.error'),
        action: () => { if (generation === this.data.generation()) this.deleteNote(note); }
      }
    });
  }

  private async deleteNote(note: StudyNote): Promise<void> { await this.data.deleteNote(note); }

  private showToast(message: string, tone: FeedbackTone = 'success'): void {
    appFeedback.show(message, tone);
  }

  private editorValue(): string { return this.noteEditor.value(); }

  private closeEditor(): void {
    if (this.data.saving) return;
    if (this.editorValue() === this.noteEditor.baseline) {
      this.noteEditor.editing = false;
      this.reportDirty();
      return;
    }
    AlertDialog.show({
      message: '随记尚未保存，确定放弃修改吗？',
      primaryButton: { value: '继续编辑', action: () => {} },
      secondaryButton: { value: '放弃修改', fontColor: $r('app.color.error'), action: () => {
        this.noteEditor.editing = false;
        this.reportDirty();
      } }
    });
  }

  private changeField(field: string, value: string): void {
    if (field === 'title') this.noteEditor.title = value;
    else if (field === 'body') this.noteEditor.body = value;
    else if (field === 'insight') this.noteEditor.insight = value;
    else if (field === 'sourcesText') this.noteEditor.sourcesText = value;
    else if (field === 'tagsText') this.noteEditor.tagsText = value;
    this.reportDirty();
  }

  private reportDirty(): void {
    this.onDirtyChange(this.noteEditor.editing && this.editorValue() !== this.noteEditor.baseline);
  }

  @Builder
  private editor() {
    Column() {
      Column({ space: 8 }) {
      Row({ space: 12 }) {
        ToolbarAction({ label: '返回随记', useSymbol: true, symbol: $r('sys.symbol.chevron_backward'),
          showLabel: false, available: !this.data.saving && !this.imageUploading, onAction: () => this.closeEditor() }).id('note_editor_back')
        Column({ space: 1 }) {
          Text(this.noteEditor.editingId ? '编辑随记' : '新建随记')
            .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.workspaceBreakpoint !== WorkspaceBreakpoint.COMPACT) {
          NoteRecordedAt({ value: this.noteEditor.recordedAt, editable: !this.data.saving && !this.imageUploading,
            onChange: (value: string) => { this.noteEditor.recordedAt = value; this.reportDirty(); } })
        }
      }
      .width('100%').height(40)
      if (this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT) {
        NoteRecordedAt({ value: this.noteEditor.recordedAt, editable: !this.data.saving && !this.imageUploading,
          onChange: (value: string) => { this.noteEditor.recordedAt = value; this.reportDirty(); } })
      }
      }
      .width('100%').padding({ top: 10, bottom: 10,
        left: this.isLargeWorkspace() ? 24 : 16, right: this.isLargeWorkspace() ? 24 : 16 })
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })

      InlineStatus({ text: this.data.errorMessage, error: true })

      Scroll(this.editorScroller) {
        Column({ space: 16 }) {
        NoteEditorFields({ title: this.noteEditor.title, body: this.noteEditor.body, insight: this.noteEditor.insight,
          sourcesText: this.noteEditor.sourcesText, tagsText: this.noteEditor.tagsText, editable: !this.data.saving,
          recordedAt: this.noteEditor.recordedAt, tagOptions: this.data.availableTags, markdownTools: true,
          onUploadBusyChange: (busy: boolean) => { this.imageUploading = busy; this.onEditorBusyChange(busy); },
          bodyHeight: 224,
          onFieldChange: (field: string, value: string) => this.changeField(field, value) })
        Row({ space: 8 }) {
          Blank().layoutWeight(1)
          ToolbarAction({ label: '取消', useSymbol: true, symbol: $r('sys.symbol.xmark'),
            available: !this.data.saving && !this.imageUploading, onAction: () => this.closeEditor() })
          ToolbarAction({ label: '保存随记', icon: $r('app.media.save'), primary: true, busy: this.data.saving,
            available: this.noteEditor.body.trim().length > 0 && !this.imageUploading,
            disabledReason: '请先填写正文', onAction: () => this.save() }).id('note_save')
        }.width('100%')
        }.width('100%').padding(this.isLargeWorkspace() ? 24 : 16)
      }
      .id('note_editor_scroll').layoutWeight(1).width('100%').scrollBar(BarState.Auto).align(Alignment.TopStart)
      .initialOffset({ xOffset: 0, yOffset: this.editorScrollOffset })
      .onScrollStart(() => this.editorUserScrolling = true)
      .onScroll(() => {
        if (this.editorUserScrolling) {
          this.editorScrollOffset = Math.max(0, this.editorScroller.currentOffset().yOffset);
        }
      })
      .onScrollStop(() => {
        if (this.editorUserScrolling) {
          this.editorScrollOffset = Math.max(0, this.editorScroller.currentOffset().yOffset);
          this.editorUserScrolling = false;
        }
      })
      .onAreaChange((oldArea: Area, newArea: Area) => {
        if (Number(oldArea.width) <= 0 ||
          (Number(oldArea.width) === Number(newArea.width) && Number(oldArea.height) === Number(newArea.height))) return;
        const restoreOffset = this.editorScrollOffset;
        if (restoreOffset <= 0) return;
        setTimeout((): void => {
          this.editorScroller.scrollTo({ xOffset: 0, yOffset: restoreOffset });
          this.editorScrollOffset = restoreOffset;
        }, 0);
      })
    }
    .width('100%').height('100%').backgroundColor($r('app.color.canvas'))
  }

  @Builder
  private noteItem(note: StudyNote) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Column({ space: 4 }) {
          Text(note.displayTitle).fontFamily(workspaceSerifFamily(this.workspaceBreakpoint)).fontSize(22 * this.readingScale)
            .copyOption(CopyOptions.LocalDevice).id(`note_title_${note.id}`)
            .fontWeight(600).fontColor($r('app.color.ink'))
            .lineHeight(28.6 * this.readingScale).width('100%')
          Text(note.recordedAt.replace('T', ' ').slice(0, 16)).fontSize(12).fontColor($r('app.color.muted'))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT) {
          Button('编辑', { type: ButtonType.Normal })
            .id(`note_edit_${note.id}`)
            .width(46).height(36).padding(0).fontSize(12)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6).clip(true)
            .onClick(() => this.startEdit(note))
        } else {
          Row({ space: 8 }) {
            Button('编辑', { type: ButtonType.Normal })
              .id(`note_edit_${note.id}`)
              .width(46).height(36).padding(0).fontSize(12)
              .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
              .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6).clip(true)
              .onClick(() => this.startEdit(note))
            Button({ type: ButtonType.Normal }) {
              Image($r('app.media.trash_2')).width(16).height(16).colorFilter(iconTint($r('app.color.error')))
            }
            .width(36).height(36).padding(0)
            .backgroundColor($r('app.color.error_surface'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6).clip(true)
            .enabled(!this.data.deletingId)
            .onClick(() => this.confirmDelete(note))
            .accessibilityText(`删除随记：${note.displayTitle}`)
          }
        }
      }.alignItems(VerticalAlign.Top)
      NoteMarkdownText({ content: note.body, onInternalLink: this.onInternalLink })
      if (note.insight) {
        Column({ space: 5 }) {
          Text('个人理解').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).width('100%')
          NoteMarkdownText({ content: note.insight, lineHeight: 24, onInternalLink: this.onInternalLink })
        }
        .padding(12).width('100%').alignItems(HorizontalAlign.Start)
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: { left: 3 }, color: $r('app.color.primary') })
      }
      if (note.sources.length > 0) {
        Text('来源　 •  ' + note.sources.join('　 •  '))
          .copyOption(CopyOptions.LocalDevice)
          .fontSize(12 * this.readingScale).lineHeight(20 * this.readingScale).fontColor($r('app.color.muted')).width('100%')
      }
      if (note.tags.length > 0) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(note.tags, (tag: string) => {
            Text(tag).fontSize(12).fontColor($r('app.color.body'))
              .padding({ left: 9, right: 9, top: 4, bottom: 4 })
              .margin({ right: 6, bottom: 6 })
              .backgroundColor($r('app.color.surface_card')).borderRadius(12)
          }, (tag: string) => tag)
        }.width('100%')
      }
    }
    .width('100%').padding({ top: 22, bottom: 22 })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(this.highlightedNoteId === note.id ? $r('app.color.primary_tint') : Color.Transparent)
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
  }

  @Builder
  private searchField() {
    SearchField({ value: this.query, placeholder: '搜索随记内容、来源或标签', placeholderFontSize: 13,
      focusKey: 'notes_search', focusRevision: this.searchRevision,
      onChange: (value: string) => { this.query = value; this.applyFilter(); },
      onSubmit: () => this.applyFilter() })
  }

  private async exportNotes(): Promise<void> {
    await this.data.exportNotes((data, current) => saveExport(
      this.getUIContext().getHostContext() as common.UIAbilityContext, 'study-notes-export.zip', data, current));
  }

  @Builder
  private desktopHeader() {
    Row({ space: 8 }) {
      ModulePageTitle({ title: '随记' }).layoutWeight(1)
      Row() { this.searchField() }.width(Math.max(220, Math.min(360, this.headerWidth - 440)))
      ToolbarAction({ label: '导出', icon: $r('app.media.download'), showLabel: this.headerWidth >= 720,
        busy: this.data.exporting, onAction: () => this.exportNotes() })
      ModuleLogButton({ onOpenLog: this.onOpenLog })
    }.id('desktop_page_notes').width('100%').height(64).padding({ left: MODULE_HEADER_LEFT_INSET, right: 16 })
      .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
      .onAreaChange((_oldArea, area) => this.headerWidth = Number(area.width))
  }

  @Builder
  private topTools() {
    if (!this.isLargeWorkspace()) {
    Column() {
      Row({ space: 8 }) {
        SearchField({
          value: this.query,
          placeholder: '搜索随记内容、来源或标签',
          placeholderFontSize: 13,
          focusKey: 'notes_search',
          focusRevision: this.searchRevision,
          onChange: (value: string) => { this.query = value; this.applyFilter(); },
          onSubmit: () => this.applyFilter()
        }).layoutWeight(1)
        ToolbarAction({
          label: '新建随记', symbol: $r('sys.symbol.plus'), useSymbol: true, showLabel: this.toolbarLabels,
          onAction: () => this.startNew()
        }).id('note_create')
      }
      .width('100%').padding({ left: 16, right: 16, top: 8, bottom: 12 })
      .onAreaChange((_oldArea, area) => {
        const required = 32 + 280 + 8 + toolbarActionsWidth(['新建随记']);
        this.toolbarLabels = this.workspaceBreakpoint !== WorkspaceBreakpoint.COMPACT &&
          Number(area.width) >= required + (this.toolbarLabels ? 0 : 12);
      })
    }
    .width('100%')
    .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
    .onAreaChange((_oldValue, newValue) => {
      this.topToolsHeight = Number(newValue.height);
      this.onScrollStateChange(this.scrollOffset >= this.topToolsHeight - 0.5);
    })
    }
  }

  @Builder
  private list() {
    Column() {
      if (this.data.loading && this.data.notes.length === 0) {
        this.topTools()
        InlineStatus({ text: this.data.errorMessage, error: true })

        ContentLoadingState({ text: '正在加载随记…' }).layoutWeight(1)
      } else if (this.data.loadFailed && this.visibleNotes.length === 0) {
        this.topTools()
        Column() {
          LoadFailure({ title: '随记读取失败', message: this.data.errorMessage, onRetry: () => this.load() })
        }.width('100%').layoutWeight(1)
      } else if (this.visibleNotes.length === 0) {
        this.topTools()
        InlineStatus({ text: this.data.errorMessage, error: true })
        EmptyState({
          symbol: $r('sys.symbol.lightbulb'),
          title: this.query ? '未找到匹配随记' : '暂无随记',
          description: this.query ? '换一个关键词再试试' : '记录一个值得长期保留的观点'
        })
      } else {
        List({ scroller: this.noteScroller }) {
          ListItem() {
            Column() {
              this.topTools()
              InlineStatus({ text: this.data.errorMessage, error: true,
                retry: this.data.loadFailed && !this.data.loading, onRetry: () => this.load() })
            }
          }
          ForEach(this.visibleNotes, (note: StudyNote) => {
            ListItem() { this.noteItem(note) }
              .padding({ left: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 24,
                right: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 24 })
              .onAreaChange((_oldValue, newValue) => {
                this.noteHeights.set(note.id, Number(newValue.height));
                this.updateNoteScrollProgress();
              })
          }, (note: StudyNote) => `${note.id}:${note.version}`)
        }
        .layoutWeight(1).width('100%').scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
        .onAreaChange((_oldValue, newValue) => {
          this.noteViewportHeight = Number(newValue.height);
          this.updateNoteScrollProgress();
        })
        .onScroll(() => this.updateNoteScrollProgress())
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
  }

  @Builder
  private pageBody() {
    Row() {
        Stack({ alignContent: Alignment.BottomEnd }) {
          Stack() {
            Row() {
              Column() { this.list() }
                .width('100%').constraintSize({ maxWidth: READING_MAX_WIDTH }).height('100%')
            }.width('100%').height('100%').justifyContent(FlexAlign.Center)
            ResultSurfaceCover({ controller: this.resultSurface })
          }.width('100%').height('100%').id('notes_result_surface')
          BackToTopControl({
            visible: this.scrollOffset > 8,
            progress: this.scrollProgress,
            scrollOffset: this.scrollOffset,
            onBackToTop: () => this.scrollToTop()
          })
            .margin({ right: this.isLargeWorkspace() ? 24 : 14, bottom: this.isLargeWorkspace() ? 24 : 14 })
            .zIndex(1)
        }
        .width('100%').height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.canvas'))
  }

  build() {
    Column() {
      if (this.isLargeWorkspace()) {
        this.desktopHeader()
      }
      Stack() {
        Column() { this.pageBody() }.width('100%').height('100%')
        Row() {
          LoadingHintAnchor({ loading: this.data.loading && this.data.notes.length > 0 && !this.noteEditor.editing,
            onChange: this.onLoadingHintChange })
        }.width('100%').height('100%').justifyContent(FlexAlign.Center).hitTestBehavior(HitTestMode.None)
      if (this.noteEditor.editing) {
        Row() {
          Column() {
            this.editor()
          }
            .width('100%').constraintSize({ maxWidth: READING_MAX_WIDTH }).height('100%')
        }.width('100%').height('100%').justifyContent(FlexAlign.Center)
          .backgroundColor($r('app.color.canvas')).transition(secondaryPageTransition())
      }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%')
  }
}

import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { droppedFileUris } from '../../../common/files/DroppedFiles';
import { ApiError, apiClient, ApiUploadFile } from '../../../common/network/ApiClient';
import { activeInstance } from '../../../common/network/InstanceConfig';
import { StudyNoteBatchResponse, StudyNoteBatchRequest, StudyNoteBatchItem, StudyNoteCandidate, StudyNoteCandidateResponse, StudyNoteFacet } from '../NoteModels';
import { cacheImportUri, NoteImportFile } from '../../../common/files/NoteImportFile';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { NoteEditorFields } from './NoteEditorFields';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';
import { NoteRecordedAt } from './NoteRecordedAt';
import { beijingNoteTimestamp } from '../NoteTime';
import { iconTint } from '../../../common/ui/IconTint';

@Observed
class CandidateDraft {
  id: string;
  kind: string;
  selected: boolean;
  title: string;
  body: string;
  insight: string;
  sourcesText: string;
  tagsText: string;
  evidence: string;
  newTagsConfirmed: boolean = false;

  constructor(candidate: StudyNoteCandidate) {
    this.id = candidate.id;
    this.kind = candidate.kind;
    this.selected = true;
    this.title = candidate.title;
    this.body = candidate.body;
    this.insight = candidate.insight;
    this.sourcesText = candidate.sources.join('\n');
    this.tagsText = candidate.tags.join('，');
    this.evidence = candidate.evidence.map((item) => item.sourceLabel + '\n' + item.quote).join('\n\n');
  }
}

@Component
struct CandidateListItem {
  @ObjectLink draft: CandidateDraft;
  @Prop selected: boolean = false;
  @Prop active: boolean = false;
  @Prop locked: boolean = false;
  @Prop ordinal: number = 1;
  onToggle: (selected: boolean) => void = () => {};
  onActivate: () => void = () => {};

  build() {
    Row({ space: 8 }) {
      Checkbox({ name: this.draft.id, group: 'candidate' }).select(this.selected)
        .width(20).height(20).selectedColor($r('app.color.primary')).enabled(!this.locked)
        .accessibilityText(`保存候选：${this.draft.title || '未命名随记'}`).onChange((selected: boolean) => this.onToggle(selected))
      Column({ space: 4 }) {
        Text(this.active ? `候选 ${this.ordinal}` : this.draft.title || '未命名随记').fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (!this.active) {
          Text(this.draft.body || '请补充正文').fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text(this.draft.kind === 'explicit' ? '材料中已有' : '归纳提炼').fontSize(12).fontColor($r('app.color.muted'))
      SymbolGlyph(this.active ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
        .fontSize(12).fontColor([$r('app.color.muted')])
    }.width('100%').padding({ top: 8, bottom: 8 })
      .onClick(() => this.onActivate())
  }
}

class UploadFile implements ApiUploadFile {
  path: string;
  name: string;
  contentType: string;

  constructor(file: NoteImportFile) {
    this.path = file.path;
    this.name = file.name;
    this.contentType = file.contentType;
  }
}

class CandidateNote implements StudyNoteBatchItem {
  clientId: string;
  title: string;
  body: string;
  insight: string;
  sources: string[];
  tags: string[];
  recordedAt: string;

  constructor(draft: CandidateDraft, recordedAt: string, values: (value: string) => string[]) {
    this.clientId = draft.id;
    this.title = draft.title.trim();
    this.body = draft.body.trim();
    this.insight = draft.insight.trim();
    this.sources = draft.sourcesText.split('\n').map((value: string) => value.trim()).filter((value: string) => value.length > 0);
    this.tags = values(draft.tagsText);
    this.recordedAt = recordedAt;
  }
}

class CandidateBatch implements StudyNoteBatchRequest {
  notes: StudyNoteBatchItem[];

  constructor(notes: StudyNoteBatchItem[]) {
    this.notes = notes;
  }
}

@Component
export struct NoteCandidateExtractor {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop initialFiles: NoteImportFile[] = [];
  @Prop tagOptions: StudyNoteFacet[] = [];
  @Prop @Watch('importRevisionChanged') importRevision: number = 0;
  @Prop initialMessage: string = '';
  onClose: () => void = () => {};
  @Prop @Watch('requestNew') newRevision: number = 0;
  onNew: () => void = () => {};
  onBusyChange: (busy: boolean) => void = () => {};
  onSaved: () => void = () => {};

  @State private files: NoteImportFile[] = [];
  @State private drafts: CandidateDraft[] = [];
  @State private loading: boolean = false;
  @State private saving: boolean = false;
  @State private message: string = '';
  @State private warning: string = '';
  @State private activeId: string = '';
  @State private materialsExpanded: boolean = true;
  @State private evidenceExpanded: boolean = false;
  @State private recordedAt: string = '';
  @State private resultSummary: string = '';
  @State private contentWidth: number = 0;
  private acceptedRevision: number = -1;
  private lifecycleRevision: number = 0;

  aboutToAppear(): void {
    this.recordedAt = this.timestamp();
    this.acceptImport();
  }

  aboutToDisappear(): void {
    this.lifecycleRevision++;
    this.files.forEach((file: NoteImportFile) => { try { fileIo.unlinkSync(file.path); } catch (_) {} });
  }

  private current(lifecycle: number, instance: number): boolean {
    return lifecycle === this.lifecycleRevision && instance === activeInstance.revision;
  }

  private importRevisionChanged(): void {
    const lifecycle = this.lifecycleRevision;
    const instance = activeInstance.revision;
    setTimeout(() => { if (this.current(lifecycle, instance)) this.acceptImport(); }, 0);
  }

  private acceptImport(): void {
    if (this.acceptedRevision === this.importRevision) return;
    this.acceptedRevision = this.importRevision;
    this.files = this.initialFiles.slice(0, 5);
    this.message = this.initialMessage;
    if (this.files.length > 0) this.extract();
  }

  private context(): common.UIAbilityContext {
    return this.getUIContext().getHostContext() as common.UIAbilityContext;
  }

  private async chooseFiles(): Promise<void> {
    if (this.loading || this.saving || this.files.length >= 5) return;
    const lifecycle = this.lifecycleRevision;
    const instance = activeInstance.revision;
    const selected: NoteImportFile[] = [];
    try {
      const viewPicker = new picker.DocumentViewPicker(this.context());
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = Math.max(1, 5 - this.files.length);
      options.fileSuffixFilters = ['文档|.txt,.md,.markdown,.pdf,.docx,.pptx'];
      const uris = await viewPicker.select(options);
      if (!this.current(lifecycle, instance)) return;
      for (let index = 0; index < uris.length && index < 5; index += 1) {
        selected.push(cacheImportUri(this.context(), uris[index], index));
      }
      if (selected.length === 0) return;
      this.files = this.files.concat(selected).slice(0, 5);
      this.message = '';
      this.warning = '';
    } catch (error) {
      selected.forEach((file: NoteImportFile) => { try { fileIo.unlinkSync(file.path); } catch (_) {} });
      if (!this.current(lifecycle, instance)) return;
      const message = error instanceof Error ? error.message : '';
      if (message) this.message = message;
    }
  }

  private removeFile(index: number): void {
    if (this.loading || this.saving) return;
    try { fileIo.unlinkSync(this.files[index].path); } catch (_) {}
    this.files = this.files.filter((_file: NoteImportFile, fileIndex: number) => fileIndex !== index);
  }

  private toDraft(candidate: StudyNoteCandidate): CandidateDraft {
    return new CandidateDraft(candidate);
  }

  private async extract(): Promise<void> {
    if (!activeInstance.capabilities?.features.aiNoteExtraction.configured) {
      this.message = '尚未配置随记提取模型'; return;
    }
    if (this.files.length === 0 || this.loading) {
      if (this.files.length === 0) this.message = '请先选择文档';
      return;
    }
    const lifecycle = this.lifecycleRevision;
    const instance = activeInstance.revision;
    this.loading = true;
    this.onBusyChange(true);
    this.message = '';
    this.warning = '';
    try {
      const documents: ParsedMaterial[] = [];
      for (const file of this.files) {
        const uploads: ApiUploadFile[] = [new UploadFile(file)];
        const parsed = await apiClient.postFiles<ParsedMaterialResponse>('/materials/extract', uploads);
        if (!this.current(lifecycle, instance)) return;
        documents.push(parsed.document);
      }
      const response = await apiClient.post<StudyNoteCandidateResponse>('/notes/candidates',
        { documents } as CandidateDocumentsRequest);
      if (!this.current(lifecycle, instance)) return;
      this.drafts = response.result.candidates.map((candidate: StudyNoteCandidate) => this.toDraft(candidate));
      this.activeId = this.drafts.length > 0 ? this.drafts[0].id : '';
      this.materialsExpanded = this.drafts.length === 0;
      this.evidenceExpanded = false;
      this.warning = response.result.warnings.join('；');
      this.resultSummary = `${response.result.documents.length} 个文件 · ${response.result.documents.reduce((sum, doc) => sum + doc.sectionCount, 0)} 个内容区段 · ${response.result.model}`;
      if (this.drafts.length === 0 && !this.warning) this.message = '这次材料中没有适合保存为随记的内容。';
    } catch (error) {
      if (this.current(lifecycle, instance)) this.message = error instanceof ApiError ? error.message : 'AI提取失败，请稍后重试';
    } finally {
      if (this.current(lifecycle, instance)) {
        this.loading = false;
        this.onBusyChange(false);
      }
    }
  }

  private refresh(): void {
    this.drafts = this.drafts.slice();
  }

  private toggle(index: number, selected: boolean): void {
    this.drafts[index].selected = selected;
    this.refresh();
  }

  private selectAll(selected: boolean): void {
    this.drafts.forEach((draft: CandidateDraft) => draft.selected = selected);
    this.refresh();
  }

  private removeDraft(index: number): void {
    this.drafts = this.drafts.filter((_draft: CandidateDraft, draftIndex: number) => draftIndex !== index);
    if (!this.drafts.some((draft: CandidateDraft) => draft.id === this.activeId)) {
      this.activeId = this.drafts.length > 0 ? this.drafts[0].id : '';
      this.evidenceExpanded = false;
    }
  }

  private dropFiles(event: DragEvent): void {
    if (this.loading || this.saving) return;
    try {
      const uris = droppedFileUris(event.getData());
      if (uris.length === 0) return;
      if (this.files.length + uris.length > 5) { this.message = '最多导入 5 个文件'; return; }
      const files = uris.map((uri: string, index: number) => cacheImportUri(this.context(), uri, index));
      this.files = this.files.concat(files);
      this.message = '';
    } catch (error) { this.message = error instanceof Error ? error.message : '无法读取拖入的文件'; }
  }

  private confirmClose(): void {
    this.confirmLeave(false);
  }

  private requestNew(): void {
    if (this.newRevision > 0) this.confirmLeave(true);
  }

  private confirmLeave(createNew: boolean): void {
    if (this.loading || this.saving) return;
    const leave = (): void => { if (createNew) this.onNew(); else this.onClose(); };
    if (this.drafts.length === 0) { leave(); return; }
    AlertDialog.show({ message: createNew ? '候选随记尚未保存，确认放弃并新建吗？' : '候选随记尚未保存，确定返回列表吗？',
      primaryButton: { value: '继续审阅', action: () => {} },
      secondaryButton: { value: createNew ? '放弃并新建' : '放弃候选', fontColor: $r('app.color.error'), action: leave } });
  }

  private confirmExtract(): void {
    if (this.drafts.length === 0) { this.extract(); return; }
    AlertDialog.show({ message: '重新提取将替换当前候选及修改，确定继续吗？',
      primaryButton: { value: '继续审阅', action: () => {} },
      secondaryButton: { value: '重新提取', action: () => this.extract() } });
  }

  private editField(index: number, field: string, value: string): void {
    const draft = this.drafts[index];
    if (field === 'title') draft.title = value;
    else if (field === 'body') draft.body = value;
    else if (field === 'insight') draft.insight = value;
    else if (field === 'sourcesText') draft.sourcesText = value;
    else if (field === 'tagsText') { draft.tagsText = value; draft.newTagsConfirmed = false; }
    this.refresh();
  }

  private activate(id: string): void {
    this.activeId = this.activeId === id ? '' : id;
    this.evidenceExpanded = false;
  }

  private values(value: string): string[] {
    return value.split(/[，,、\n]/).map((item: string) => item.trim()).filter((item: string) => item.length > 0);
  }

  private newTags(draft: CandidateDraft): string[] {
    const known = this.tagOptions.map((tag: StudyNoteFacet) => tag.value.replace(/\s+/g, '').toLowerCase());
    return this.values(draft.tagsText).filter((tag: string) => !known.includes(tag.replace(/\s+/g, '').toLowerCase()));
  }

  private timestamp(): string {
    return beijingNoteTimestamp();
  }

  private async saveSelected(): Promise<void> {
    if (this.saving) return;
    const lifecycle = this.lifecycleRevision;
    const instance = activeInstance.revision;
    const selected = this.drafts.filter((draft: CandidateDraft) => draft.selected);
    if (selected.length === 0) {
      this.message = '请至少选择一条有正文的候选随记';
      return;
    }
    if (selected.some((draft: CandidateDraft) => !draft.body.trim())) {
      this.message = '选中的候选随记正文不能为空';
      return;
    }
    const unconfirmed = selected.find((draft: CandidateDraft) => this.newTags(draft).length > 0 && !draft.newTagsConfirmed);
    if (unconfirmed) {
      this.message = `请先确认“${unconfirmed.title || '未命名随记'}”中的新增标签`;
      this.activeId = unconfirmed.id;
      return;
    }
    this.saving = true;
    this.onBusyChange(true);
    this.message = '';
    const recordedAt = this.recordedAt;
    const notes: StudyNoteBatchItem[] = [];
    selected.forEach((draft: CandidateDraft) => notes.push(new CandidateNote(draft, recordedAt,
      (value: string): string[] => this.values(value))));
    try {
      const response = await apiClient.post<StudyNoteBatchResponse>('/notes/batch', new CandidateBatch(notes));
      if (!this.current(lifecycle, instance)) return;
      if (!response || !Array.isArray(response.notes) || response.notes.length !== notes.length ||
        response.notes.some((note, index) => !note || note.id !== notes[index].clientId)) {
        this.message = '未能确认保存结果，候选仍保留，请重试';
        return;
      }
      this.onSaved();
    } catch (error) {
      if (this.current(lifecycle, instance)) this.message = error instanceof ApiError ? error.message : '候选随记保存失败';
    } finally {
      if (this.current(lifecycle, instance)) {
        this.saving = false;
        this.onBusyChange(false);
      }
    }
  }

  @Builder
  private candidateCard(draft: CandidateDraft, index: number) {
    Column({ space: 16 }) {
      NoteEditorFields({ title: draft.title, body: draft.body, insight: draft.insight,
        sourcesText: draft.sourcesText, tagsText: draft.tagsText, editable: !this.saving,
        tagOptions: this.tagOptions, bodyHeight: 176,
        onFieldChange: (field: string, value: string) => this.editField(index, field, value) })
      if (this.newTags(this.drafts[index]).length > 0) {
        Row({ space: 8 }) {
          Checkbox().select(this.drafts[index].newTagsConfirmed).selectedColor($r('app.color.primary'))
            .onChange((value: boolean) => { this.drafts[index].newTagsConfirmed = value; this.refresh(); })
          Text('确认新增标签：' + this.newTags(this.drafts[index]).join('、'))
            .fontSize(12).fontColor($r('app.color.muted')).layoutWeight(1)
        }.width('100%')
      }
      if (draft.evidence) {
        Column({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              Text('原文依据').fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.body')).layoutWeight(1)
              Text(this.evidenceExpanded ? '收起' : '展开').fontSize(12).fontColor($r('app.color.muted'))
              SymbolGlyph(this.evidenceExpanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                .fontSize(12).fontColor([$r('app.color.muted')])
            }.width('100%')
          }.width('100%').height(40).padding(0).backgroundColor(Color.Transparent)
            .onClick(() => this.evidenceExpanded = !this.evidenceExpanded)
          if (this.evidenceExpanded) {
            Text(draft.evidence).fontSize(14).lineHeight(22).fontColor($r('app.color.body')).width('100%')
              .copyOption(CopyOptions.LocalDevice)
          }
        }.width('100%').padding(12).backgroundColor($r('app.color.surface_soft')).borderRadius(8)
      }
      Row() {
        Blank().layoutWeight(1)
        ToolbarAction({ label: '移除候选', useSymbol: true, symbol: $r('sys.symbol.trash'),
          available: !this.saving, onAction: () => this.removeDraft(index) })
      }.width('100%')
    }.width('100%').padding({ bottom: 16 }).alignItems(HorizontalAlign.Start)
  }

  @Builder
  private candidateRow(draft: CandidateDraft, index: number) {
    CandidateListItem({ draft: this.drafts[index], selected: draft.selected,
      active: this.activeId === draft.id, locked: this.saving, ordinal: index + 1,
      onToggle: (selected: boolean) => this.toggle(index, selected), onActivate: () => this.activate(draft.id) })
  }

  @Builder
  private materialIntro() {
    Row({ space: 12 }) {
      Image($r('app.media.upload')).width(20).height(20).colorFilter(iconTint($r('app.color.primary')))
      Column({ space: 4 }) {
        Text(this.drafts.length > 0 ? `学习材料 · ${this.files.length} 个文件` : '导入学习材料')
          .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        if (this.materialsExpanded) {
          Text('支持 PDF、Word、PPT、Markdown 和 TXT；最多 5 个文件，每个不超过 20 MB。')
            .fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
        }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
    }.width('100%')
  }

  @Builder
  private materialActions() {
    Row({ space: 8 }) {
      if (this.materialsExpanded) {
        if (this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT) {
          Button(this.files.length > 0 ? '添加文件' : '选择文件', { type: ButtonType.Normal, stateEffect: false })
            .layoutWeight(1).height(40).fontFamily('HarmonyOS Sans SC').fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).shadow({ radius: 0 })
            .enabled(!this.loading && !this.saving && this.files.length < 5)
            .onClick(() => this.chooseFiles())
        } else {
        ToolbarAction({ label: this.files.length > 0 ? '添加文件' : '选择文件', icon: $r('app.media.upload'),
          showIcon: false,
          available: !this.loading && !this.saving && this.files.length < 5, onAction: () => this.chooseFiles() })
        }
      }
      if (this.drafts.length > 0) {
        ToolbarAction({ label: this.materialsExpanded ? '收起材料' : '展开材料', useSymbol: true,
          symbol: this.materialsExpanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'),
          showLabel: false, controlHeight: 32, iconWidth: 32, onAction: () => this.materialsExpanded = !this.materialsExpanded })
      }
    }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT && this.materialsExpanded ? '100%' : 'auto')
  }

  @Builder
  private extractAction() {
      Button({ type: ButtonType.Normal, stateEffect: false }) {
        Row({ space: 6 }) {
          if (this.loading) {
            LoadingProgress().width(18).height(18).color($r('app.color.on_primary'))
          } else {
            Image($r('app.media.sparkles')).width(18).height(18).colorFilter(iconTint($r('app.color.on_primary')))
          }
          Text(this.loading ? '正在提取…' : (this.drafts.length > 0 ? '重新提取' : '提取候选'))
            .fontFamily('HarmonyOS Sans SC').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.on_primary'))
        }.justifyContent(FlexAlign.Center)
      }.width(this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : 112).height(40).padding(0).backgroundColor($r('app.color.primary'))
        .borderRadius(8).shadow({ radius: 0 }).enabled(this.files.length > 0 && !this.saving && !this.loading &&
          !!activeInstance.capabilities?.features.aiNoteExtraction.configured)
        .accessibilityText(this.files.length > 0 ? '提取候选' : '提取候选，请先选择文档')
        .onClick(() => this.confirmExtract())
        .id('note_extract_action')
  }

  @Builder
  private materials() {
    Column({ space: 12 }) {
      Column({ space: 12 }) {
        if (this.contentWidth >= 600 || !this.materialsExpanded) {
          Row({ space: 16 }) {
            Column() { this.materialIntro() }.layoutWeight(1)
            this.materialActions()
          }.width('100%')
        } else {
          this.materialIntro()
          Row() { this.materialActions() }.width('100%').justifyContent(FlexAlign.End)
        }
        if (this.materialsExpanded) {
        ForEach(this.files, (file: NoteImportFile, index: number) => {
          Row({ space: 8 }) {
            Text(file.name).fontSize(14).fontColor($r('app.color.body')).maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            Text(file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` :
              `${Math.max(1, Math.ceil(file.size / 1024))} KB`).fontSize(12).fontColor($r('app.color.muted'))
            if (!this.loading) {
              ToolbarAction({ label: '移除文件', useSymbol: true, symbol: $r('sys.symbol.xmark'),
                showLabel: false, available: !this.loading, onAction: () => this.removeFile(index) })
            }
          }.width('100%')
        }, (file: NoteImportFile) => file.path)
        }
      }.width('100%').padding(this.materialsExpanded ? 16 : 12)
        .backgroundColor($r('app.color.surface_soft'))
        .border({ width: 1, color: $r('app.color.hairline'), style: BorderStyle.Dashed }).borderRadius(8)
        .onDrop((event: DragEvent) => this.dropFiles(event))
      if (this.materialsExpanded) {
        if (this.contentWidth >= 600) {
          Row({ space: 16 }) {
            Text(this.loading ? '正在分析文档…' : '文件正文将发送给已配置的模型处理，原件不会保存在服务器中。')
              .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).layoutWeight(1)
            this.extractAction()
          }.width('100%')
        } else {
          Text(this.loading ? '正在分析文档…' : '文件正文将发送给已配置的模型处理，原件不会保存在服务器中。')
            .width('100%').fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
          Row() { this.extractAction() }.width('100%').justifyContent(FlexAlign.End)
        }
      }
    }.width('100%')
  }

  @Builder
  private selectionHeader() {
    Row({ space: 8 }) {
      Text(`候选随记 · ${this.drafts.length}`).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.ink')).layoutWeight(1)
      Button('全选').height(40).fontSize(12).backgroundColor(Color.Transparent)
        .fontColor($r('app.color.body')).onClick(() => this.selectAll(true))
      Button('清空').height(40).fontSize(12).backgroundColor(Color.Transparent)
        .fontColor($r('app.color.body')).onClick(() => this.selectAll(false))
    }.width('100%').enabled(!this.saving)
  }

  @Builder
  private candidates() {
    Column({ space: 8 }) {
      ForEach(this.drafts, (draft: CandidateDraft, index: number) => {
        Column({ space: 8 }) {
          this.candidateRow(draft, index)
          if (draft.id === this.activeId) { this.candidateCard(draft, index) }
        }.width('100%').border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
      }, (draft: CandidateDraft) => draft.id)
    }.width('100%')
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Row({ space: 12 }) {
          ToolbarAction({ label: '返回随记列表', useSymbol: true, symbol: $r('sys.symbol.chevron_backward'),
            showLabel: false, available: !this.loading && !this.saving,
            onAction: () => this.confirmClose() }).id('note_extractor_back')
          Column({ space: 4 }) {
            Text('AI提取随记').fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
            Text('从文档中筛选值得长期保留的观点、经验和判断。').fontSize(12).lineHeight(18).fontColor($r('app.color.muted'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%').padding({ top: 16, bottom: 16 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        this.materials()
        if (!activeInstance.capabilities?.features.aiNoteExtraction.configured) {
          Text('尚未配置随记提取模型').fontSize(12).fontColor($r('app.color.muted'))
        }
        InlineStatus({ text: this.message, error: true })
        InlineStatus({ text: this.warning, error: false })
        if (this.drafts.length > 0) {
          Row() {
            NoteRecordedAt({ value: this.recordedAt, editable: !this.saving,
              onChange: (value: string) => this.recordedAt = value })
          }.width('100%').justifyContent(FlexAlign.End)
          this.selectionHeader()
          this.candidates()
          Text(this.resultSummary).fontSize(12).fontColor($r('app.color.muted')).width('100%')
          Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center, justifyContent: FlexAlign.SpaceBetween }) {
            Text(`已选 ${this.drafts.filter((draft: CandidateDraft) => draft.selected).length} / ${this.drafts.length} 条`)
              .fontSize(12).fontColor($r('app.color.muted'))
            Row({ space: 8 }) {
              ToolbarAction({ label: '取消', useSymbol: true, symbol: $r('sys.symbol.xmark'),
                available: !this.loading && !this.saving, onAction: () => this.confirmClose() })
              ToolbarAction({ label: '保存选中项', icon: $r('app.media.save'), primary: true, busy: this.saving,
                available: !this.loading && this.drafts.some((draft: CandidateDraft) => draft.selected),
                disabledReason: '请至少选择一条候选', onAction: () => this.saveSelected() })
            }.padding({ top: 8, bottom: 8 })
          }.width('100%')
        }
      }.width('100%').padding({ top: 0, bottom: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 24,
        left: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 24,
        right: this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 24 })
        .alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').align(Alignment.TopStart).scrollBar(BarState.Auto)
      .backgroundColor($r('app.color.canvas'))
      .onAreaChange((_old: Area, area: Area) => this.contentWidth = Number(area.width))
  }
}

interface ParsedMaterialSection { id: string; locator: string; text: string; }

interface ParsedMaterial {
  fileName: string;
  fileType: string;
  size: number;
  text: string;
  sections: ParsedMaterialSection[];
  warnings: string[];
}

interface ParsedMaterialResponse { document: ParsedMaterial; }
interface CandidateDocumentsRequest { documents: ParsedMaterial[]; }

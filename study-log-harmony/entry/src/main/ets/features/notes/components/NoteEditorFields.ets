import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { textNavigationKey } from '../../../common/ui/WorkspaceKeys';
import { ToolbarAction } from '../../../common/ui/ToolbarAction';
import { EditorLinkPicker } from '../../../common/editor/EditorLinkPicker';
import { common } from '@kit.AbilityKit';
import { picker, fileIo } from '@kit.CoreFileKit';
import { apiClient, ApiUploadFile } from '../../../common/network/ApiClient';
import { appFeedback } from '../../../common/ui/AppFeedback';
import { StudyNoteFacet } from '../NoteModels';

interface NoteUploadResult { assets: NoteUploadedAsset[]; }
interface NoteUploadedAsset { markdown: string; }

@Component
export struct NoteEditorFields {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Prop title: string = '';
  @Prop body: string = '';
  @Prop insight: string = '';
  @Prop sourcesText: string = '';
  @Prop tagsText: string = '';
  @Prop recordedAt: string = '';
  @Prop tagOptions: StudyNoteFacet[] = [];
  @Prop bodyHeight: number = 224;
  @Prop editable: boolean = true;
  @Prop markdownTools: boolean = false;
  onFieldChange: (field: string, value: string) => void = () => {};
  onUploadBusyChange: (busy: boolean) => void = () => {};
  @State private uploading: boolean = false;
  @State private contentWidth: number = 0;
  @State private linkOpen: boolean = false;
  @State private tagQuery: string = '';
  @State private tagsOpen: boolean = false;
  @State private metaHeight: number = 56;
  @State private tagWidth: number = 280;
  @State private tagContentHeight: number = 40;
  private resizeStart: number = 56;
  private bodyController: TextAreaController = new TextAreaController();
  private insightController: TextAreaController = new TextAreaController();
  private activeField: string = 'body';
  private from: number = 0;
  private to: number = 0;
  private bodyFrom: number = 0;
  private bodyTo: number = 0;
  private insightFrom: number = 0;
  private insightTo: number = 0;

  private change(field: string, value: string): void {
    if (field === 'body') this.body = value;
    if (field === 'insight') this.insight = value;
    if (field === 'tagsText') this.tagsText = value;
    this.onFieldChange(field, value);
  }

  private select(field: string, from: number, to: number): void {
    if (field === 'body') { this.bodyFrom = from; this.bodyTo = to; }
    else { this.insightFrom = from; this.insightTo = to; }
    if (field !== this.activeField) return;
    this.from = from;
    this.to = to;
  }

  private focusField(field: string): void {
    this.activeField = field;
    this.from = field === 'body' ? this.bodyFrom : this.insightFrom;
    this.to = field === 'body' ? this.bodyTo : this.insightTo;
  }

  private selectedText(): string {
    const value = this.activeField === 'body' ? this.body : this.insight;
    return value.slice(this.from, this.to);
  }

  private insert(markup: string, start: number = markup.length, end: number = start): void {
    const field = this.activeField;
    const value = field === 'body' ? this.body : this.insight;
    const from = Math.min(this.from, value.length);
    this.change(field, value.slice(0, from) + markup + value.slice(this.to));
    setTimeout(() => {
      focusControl.requestFocus(field === 'body' ? 'note_body' : 'note_insight');
      const controller = field === 'body' ? this.bodyController : this.insightController;
      controller.setTextSelection(from + start, from + end);
    }, 0);
  }

  private inline(marker: string, fallback: string): void {
    const text = this.selectedText() || fallback;
    this.insert(marker + text + marker, marker.length, marker.length + text.length);
  }

  private externalLink(): void {
    const text = this.selectedText() || '链接文字';
    this.insert('[' + text + '](https://)', text.length + 3, text.length + 11);
  }

  private async insertImages(): Promise<void> {
    if (this.uploading || !this.editable) return;
    this.uploading = true;
    this.onUploadBusyChange(true);
    const cached: ApiUploadFile[] = [];
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 5;
      options.fileSuffixFilters = ['图片|.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg'];
      const uris = await new picker.DocumentViewPicker(context).select(options);
      for (let index = 0; index < uris.length; index++) {
        const extension = uris[index].split('.').pop()?.toLowerCase() || 'png';
        const name = `note-image-${Date.now()}-${index}.${extension}`;
        const path = `${context.cacheDir}/${name}`;
        const source = fileIo.openSync(uris[index], fileIo.OpenMode.READ_ONLY);
        try {
          const target = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
          try { fileIo.copyFileSync(source.fd, target.fd); } finally { fileIo.closeSync(target); }
        } finally { fileIo.closeSync(source); }
        cached.push({ path, name, contentType: 'image/' + (extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension) });
      }
      if (!cached.length) return;
      const result = await apiClient.postFiles<NoteUploadResult>('/assets/upload', cached, this.recordedAt.slice(0, 4));
      this.insert('\n' + result.assets.map((asset: NoteUploadedAsset) => asset.markdown).join('\n') + '\n');
    } catch (error) {
      appFeedback.show(error instanceof Error ? error.message : '图片上传失败', 'error');
    } finally {
      cached.forEach((file: ApiUploadFile) => { try { fileIo.unlinkSync(file.path); } catch (_) {} });
      this.uploading = false;
      this.onUploadBusyChange(false);
    }
  }

  private tags(): string[] {
    return this.tagsText.split(/[，,、\n]/).map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
  }

  private addTag(value: string): void {
    const tags = this.tags();
    value = value.trim();
    if (value && !tags.some((tag: string) => this.tagKey(tag) === this.tagKey(value)) && tags.length < 20) {
      this.change('tagsText', tags.concat([value]).join('，'));
    }
    this.tagQuery = '';
  }

  private tagKey(value: string): string { return value.replace(/\s+/g, '').toLowerCase(); }

  private tagChoices(): string[] {
    return this.tagOptions.map((tag: StudyNoteFacet) => tag.value).concat(this.tags()).filter((tag: string, index: number, tags: string[]) =>
      tags.findIndex((other: string) => this.tagKey(other) === this.tagKey(tag)) === index &&
      this.tagKey(tag).includes(this.tagKey(this.tagQuery)))
      .sort((left: string, right: string) => this.tagCount(right) - this.tagCount(left) || left.localeCompare(right));
  }

  private tagCount(value: string): number {
    return this.tagOptions.find((tag: StudyNoteFacet) => this.tagKey(tag.value) === this.tagKey(value))?.count ?? 0;
  }

  private toggleTag(tag: string): void {
    if (this.tags().some((item: string) => this.tagKey(item) === this.tagKey(tag))) {
      this.change('tagsText', this.tags().filter((item: string) => this.tagKey(item) !== this.tagKey(tag)).join('，'));
    } else { this.addTag(tag); }
  }

  @Builder
  private label(title: string) {
    Text(title).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.body')).width('100%')
  }

  @Builder
  private tools() {
    Row({ space: 4 }) {
      ToolbarAction({ label: '加粗', useSymbol: true, symbol: $r('sys.symbol.bold'),
        showLabel: false, controlHeight: 32, iconWidth: 32, onAction: () => this.inline('**', '重点内容') }).id('note_bold')
      ToolbarAction({ label: '斜体', useSymbol: true, symbol: $r('sys.symbol.italic'),
        showLabel: false, controlHeight: 32, iconWidth: 32, onAction: () => this.inline('*', '强调内容') })
      ToolbarAction({ label: '插入链接', icon: $r('app.media.link_2'),
        showLabel: false, controlHeight: 32, iconWidth: 32, onAction: () => this.externalLink() })
      ToolbarAction({ label: '内部链接', useSymbol: true, symbol: $r('sys.symbol.link'),
        showLabel: false, controlHeight: 32, iconWidth: 32, onAction: () => this.linkOpen = true })
      ToolbarAction({ label: '插入图片', icon: $r('app.media.file_image'), showLabel: false,
        controlHeight: 32, iconWidth: 32, busy: this.uploading, onAction: () => this.insertImages() }).id('note_insert_image')
    }.width('100%')
  }

  @Builder
  private sources() {
    Column({ space: 8 }) {
      this.label('来源')
      Stack({ alignContent: Alignment.BottomEnd }) {
      TextArea({ text: this.sourcesText, placeholder: '每行一项，可填写链接或来源名称' })
        .height(Math.max(this.metaHeight, this.tagContentHeight + 16)).fontSize(14).lineHeight(22).monopolizeEvents(true)
        .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .onChange((value: string) => this.change('sourcesText', value))
      if (this.breakpoint !== WorkspaceBreakpoint.COMPACT) {
        Text('◢').fontSize(12).fontColor($r('app.color.muted_soft')).width(24).height(24).textAlign(TextAlign.End)
          .accessibilityText('拖动调整来源和标签高度').id('note_meta_resize')
          .gesture(PanGesture({ direction: PanDirection.Vertical }).onActionStart(() => this.resizeStart = this.metaHeight)
            .onActionUpdate((event: GestureEvent) => this.metaHeight = Math.max(56, Math.min(240, this.resizeStart + event.offsetY))))
      }
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private tagField() {
    Column({ space: 8 }) {
      this.label('标签')
      Scroll() {
      Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Center }) {
          ForEach(this.tags(), (tag: string) => {
            Button(tag + ' ×').height(28).fontSize(12).fontColor($r('app.color.body'))
              .backgroundColor($r('app.color.surface_card')).margin({ right: 4, top: 6, bottom: 6 })
              .flexShrink(0).constraintSize({ maxWidth: Math.max(80, this.tagWidth - 16) })
              .onClick(() => this.change('tagsText', this.tags().filter((item: string) => item !== tag).join('，')))
          }, (tag: string) => tag)
      TextInput({ text: this.tagQuery, placeholder: '搜索或创建标签' }).height(40).fontSize(14).id('note_tag_search')
        .width(160).flexGrow(1).flexShrink(0).padding({ left: 4, right: 4 })
        .monopolizeEvents(true).backgroundColor($r('app.color.canvas'))
        .borderRadius(8)
        .onFocus(() => this.tagsOpen = true).onClick(() => this.tagsOpen = true)
        .onChange((value: string) => { this.tagQuery = value; this.tagsOpen = true; })
        .onSubmit(() => this.addTag(this.tagQuery))
      }.width('100%').onAreaChange((_old: Area, area: Area) => this.tagContentHeight = Number(area.height))
      }.width('100%').height(Math.max(this.metaHeight, this.tagContentHeight + 16)).padding(8).scrollBar(BarState.Auto)
        .align(Alignment.TopStart)
        .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .onAreaChange((_old: Area, area: Area) => this.tagWidth = Number(area.width))
        .bindPopup(this.tagsOpen, { builder: this.tagDropdown(), placement: Placement.TopLeft, enableArrow: false,
          radius: 8, backgroundBlurStyle: BlurStyle.NONE, targetSpace: 4,
          shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
          width: this.tagWidth, popupColor: $r('app.color.canvas'), autoCancel: true,
          onStateChange: (event) => { if (!event.isVisible) this.tagsOpen = false; } })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }

  @Builder
  private tagDropdown() {
    Scroll() {
      Column() {
        ForEach(this.tagChoices(), (tag: string) => {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              Text(tag).fontSize(13).fontColor($r('app.color.body')).layoutWeight(1)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(this.tags().some((item: string) => this.tagKey(item) === this.tagKey(tag)) ? '✓' : '').width(18)
                .fontColor($r('app.color.primary_active'))
              Text(this.tagCount(tag).toString()).fontSize(11).fontColor($r('app.color.muted_soft'))
                .width(Math.max(28, ...this.tagOptions.map((item: StudyNoteFacet) => item.count.toString().length * 8)))
                .textAlign(TextAlign.End).accessibilityText(`使用 ${this.tagCount(tag)} 次`)
            }.width('100%').padding({ left: 12, right: 12 })
          }.width('100%').height(36).padding(0).backgroundColor(Color.Transparent).onClick(() => this.toggleTag(tag))
        })
        if (this.tagQuery.trim() && !/[，,、\n]/.test(this.tagQuery) && !this.tagChoices().some((tag: string) => this.tagKey(tag) === this.tagKey(this.tagQuery))) {
          Button('创建标签：' + this.tagQuery.trim()).width('100%').height(36).fontSize(13)
            .fontColor($r('app.color.primary_active')).backgroundColor(Color.Transparent).onClick(() => this.addTag(this.tagQuery))
        } else if (this.tagChoices().length === 0) {
          Text('没有匹配的标签').fontSize(12).fontColor($r('app.color.muted')).padding(12)
        }
      }.width('100%')
    }.constraintSize({ maxHeight: 220 }).width('100%')
  }

  @Builder
  private linkPanel() {
    EditorLinkPicker({ initialAlias: this.selectedText(), onClose: () => this.linkOpen = false,
      onInsert: async (markup: string) => { this.linkOpen = false; this.insert(markup); } })
  }

  build() {
    Column({ space: 16 }) {
      TextInput({ text: this.title, placeholder: '标题（选填，留空时显示正文首句）' })
        .id('note_title')
        .height(40).fontSize(14).maxLength(120).monopolizeEvents(true)
        .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .onChange((value: string) => this.change('title', value))
      Column({ space: 8 }) {
        if (this.markdownTools) { this.tools() }
        TextArea({ text: this.body, controller: this.bodyController, placeholder: '记录一个值得长期保留的观点、经验或判断…' })
          .id('note_body').height(this.bodyHeight).fontSize(14).lineHeight(22).monopolizeEvents(true)
          .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .onTextSelectionChange((start: number, end: number) => this.select('body', start, end))
          .onFocus(() => this.focusField('body'))
          .onChange((value: string) => this.change('body', value))
      }.width('100%')
      Column({ space: 8 }) {
        this.label('个人理解')
        TextArea({ text: this.insight, controller: this.insightController, placeholder: '选填：写下判断、适用边界或行动启发' })
          .id('note_insight').height(104).fontSize(14).lineHeight(22).monopolizeEvents(true)
          .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .onTextSelectionChange((start: number, end: number) => this.select('insight', start, end))
          .onFocus(() => this.focusField('insight'))
          .onChange((value: string) => this.change('insight', value))
      }.width('100%')
      if (this.contentWidth >= 600) {
        Row({ space: 16 }) {
          Column() { this.sources() }.layoutWeight(1)
          Column() { this.tagField() }.layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Top)
      } else {
        this.sources()
        this.tagField()
      }
    }.width('100%').enabled(this.editable && !this.uploading)
      .onKeyEvent((event: KeyEvent) => textNavigationKey(event))
      .onAreaChange((_old: Area, area: Area) => this.contentWidth = Number(area.width))
      .bindSheet($$this.linkOpen, this.linkPanel(), {
        preferType: this.breakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
        width: this.breakpoint === WorkspaceBreakpoint.COMPACT ? '100%' : 780,
        height: this.breakpoint === WorkspaceBreakpoint.COMPACT ? SheetSize.LARGE : 620,
        dragBar: false, showClose: false, backgroundColor: Color.Transparent,
        keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY, maskColor: $r('app.color.scrim'),
        radius: { topLeft: 12, topRight: 12, bottomLeft: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12,
          bottomRight: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12 }
      })
  }
}

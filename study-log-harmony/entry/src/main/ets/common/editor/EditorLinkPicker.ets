import { LengthMetrics } from '@kit.ArkUI';
import { WorkspaceBreakpoint } from '../AppConfig';
import { apiClient } from '../network/ApiClient';
import { EmptyState, InlineStatus } from '../ui/FeedbackStates';
import { SearchField } from '../ui/FormControls';
import { workspaceSerifFamily } from '../ui/Typography';
import { EditorLinkCandidate, EditorLinksResponse, editorLinkMarkup } from './EditorLinks';

@Component
export struct EditorLinkPicker {
  @Consume('workspaceBreakpoint') private breakpoint: WorkspaceBreakpoint;
  @Prop initialAlias: string = '';
  onInsert: (markup: string) => Promise<void> = async () => {};
  onClose: () => void = () => {};
  @State private query: string = '';
  @State private alias: string = '';
  @State private results: EditorLinkCandidate[] = [];
  @State private loading: boolean = true;
  @State private inserting: boolean = false;
  @State private error: string = '';
  @State private activeIndex: number = -1;
  @State private narrow: boolean = false;
  private revision: number = 0;
  private lifecycle: number = 0;
  private timer: number = -1;
  private scroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.lifecycle++;
    this.query = this.initialAlias.slice(0, 500);
    this.alias = this.initialAlias;
    this.search();
  }

  aboutToDisappear(): void {
    this.lifecycle++;
    this.revision++;
    if (this.timer >= 0) clearTimeout(this.timer);
  }

  private search(): void {
    const revision = ++this.revision;
    if (this.timer >= 0) clearTimeout(this.timer);
    this.loading = true;
    this.error = '';
    this.activeIndex = -1;
    this.timer = setTimeout(async () => {
      try {
        const response = await apiClient.get<EditorLinksResponse>(`/links?query=${encodeURIComponent(this.query)}`);
        if (revision !== this.revision) return;
        if (!response || !Array.isArray(response.results)) throw new Error('链接目标响应格式异常');
        this.results = response.results;
      } catch (error) {
        if (revision === this.revision) {
          this.results = [];
          this.error = error instanceof Error ? error.message : '读取链接目标失败';
        }
      } finally { if (revision === this.revision) this.loading = false; }
    }, 160);
  }

  private async insert(candidate: EditorLinkCandidate): Promise<void> {
    if (this.inserting) return;
    const lifecycle = this.lifecycle;
    this.inserting = true;
    this.error = '';
    try { await this.onInsert(editorLinkMarkup(candidate, this.alias)); }
    catch (error) { if (lifecycle === this.lifecycle) this.error = error instanceof Error ? error.message : '插入失败'; }
    finally { if (lifecycle === this.lifecycle) this.inserting = false; }
  }

  private searchKey(event: KeyEvent): boolean {
    if (event.type !== KeyType.Down) return false;
    if (event.keyCode === 2070) { this.onClose(); return true; }
    if ([2012, 2013].includes(event.keyCode) && this.results.length > 0 && !this.loading) {
      this.activeIndex = Math.max(0, Math.min(this.results.length - 1,
        this.activeIndex + (event.keyCode === 2013 ? 1 : -1)));
      this.scroller.scrollToIndex(this.activeIndex);
      return true;
    }
    if (event.keyCode === 2054 && this.activeIndex >= 0 && !this.loading) {
      this.insert(this.results[this.activeIndex]);
      return true;
    }
    return false;
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Column({ space: 3 }) {
          Text('插入内部链接').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(24)
            .fontColor($r('app.color.ink'))
          Text('选择日块或小节，自动生成跳转语法。').fontSize(12).fontColor($r('app.color.muted'))
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button('关闭', { type: ButtonType.Normal }).fontSize(13)
          .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .enabled(!this.inserting).onClick(() => this.onClose())
      }.width('100%').padding(16).border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
      Flex({ direction: this.narrow ? FlexDirection.Column : FlexDirection.Row,
        space: { main: LengthMetrics.vp(10) } }) {
        SearchField({ value: this.query, placeholder: '搜索日期、小节标题或正文', compact: true,
          showSubmit: false, loading: this.loading,
          onSearchKey: (event: KeyEvent) => this.searchKey(event),
          onChange: (value: string) => { this.query = value; this.search(); },
          onClear: () => { this.query = ''; this.search(); } })
          .width(this.narrow ? '100%' : '58%')
        TextInput({ text: this.alias, placeholder: '显示文字（默认用目标标题）' })
          .height(40).fontSize(13).fontColor($r('app.color.ink'))
          .placeholderFont({ size: 13 }).placeholderColor($r('app.color.muted'))
          .backgroundColor($r('app.color.surface_soft'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .onChange((value: string) => this.alias = value)
          .width(this.narrow ? '100%' : '40%')
      }.width('100%').padding(16)
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
      if (this.error) InlineStatus({ text: this.error, error: true })
      if (this.loading && this.results.length === 0) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在搜索链接目标').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (!this.loading && this.results.length === 0 && !this.error) {
        EmptyState({ title: '没有匹配的日块或小节', description: '试试日期、标题或正文中的词。' })
      } else {
        List({ scroller: this.scroller }) {
          ForEach(this.results, (candidate: EditorLinkCandidate, index: number) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  SymbolGlyph(candidate.kind === 'day' ? $r('sys.symbol.calendar') : $r('sys.symbol.doc_text'))
                    .fontSize(19).fontColor([$r('app.color.primary')]).width(32)
                  Column({ space: 3 }) {
                    Row({ space: 8 }) {
                      Text(candidate.heading || `${candidate.date} 日块`).fontSize(13)
                        .fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
                        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                      Text(candidate.date).fontSize(11).fontColor($r('app.color.muted'))
                    }.width('100%')
                    Text(candidate.preview).fontSize(12).fontColor($r('app.color.muted'))
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%').textAlign(TextAlign.Start)
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%')
              }.width('100%').constraintSize({ minHeight: 66 })
                .padding({ left: 11, right: 11, top: 9, bottom: 9 }).borderRadius(6)
                .backgroundColor(this.activeIndex === index ? $r('app.color.surface_soft') : Color.Transparent)
                .enabled(!this.inserting && !this.loading)
                .onHover((hover: boolean) => { if (hover) this.activeIndex = index; })
                .onClick(() => this.insert(candidate))
            }
          }, (candidate: EditorLinkCandidate) => `${candidate.date}:${candidate.heading || ''}`)
        }.layoutWeight(1).width('100%').padding(8).scrollBar(BarState.Auto)
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      .onAreaChange((_old, area) => this.narrow = Number(area.width) < 580)
  }
}

import { ActionPanelHeader } from '../ui/WorkspaceChrome';
import { SearchField } from '../ui/FormControls';
import { InlineStatus } from '../ui/FeedbackStates';
import { WORKSPACE_TIPS } from '../ui/WorkspaceTips';
import { LengthMetrics } from '@kit.ArkUI';
import { WorkspaceBreakpoint } from '../AppConfig';
import { workspaceSerifFamily } from '../ui/Typography';
import { iconTint } from '../ui/IconTint';
import { apiClient } from '../network/ApiClient';
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
  private revision: number = 0;
  private timer: number = -1;
  private focusTimer: number = -1;
  private lifecycleRevision: number = 0;
  @State private narrow: boolean = false;
  @State private activeIndex: number = -1;
  private pointerActive: boolean = false;
  private scroller: Scroller = new Scroller();

  aboutToAppear(): void {
    this.inserting = false;
    this.query = this.initialAlias.slice(0, 500);
    this.alias = this.initialAlias;
    this.search();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = -1;
      focusControl.requestFocus('editor_link_search');
    }, 60);
  }

  aboutToDisappear(): void {
    this.revision++;
    this.lifecycleRevision++;
    if (this.timer >= 0) clearTimeout(this.timer);
    if (this.focusTimer >= 0) clearTimeout(this.focusTimer);
    this.focusTimer = -1;
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
      } finally {
        if (revision === this.revision) this.loading = false;
      }
    }, 160);
  }

  private async insert(candidate: EditorLinkCandidate): Promise<void> {
    if (this.inserting) return;
    const revision = this.lifecycleRevision;
    this.inserting = true;
    try { await this.onInsert(editorLinkMarkup(candidate, this.alias)); }
    catch (error) {
      if (revision === this.lifecycleRevision) this.error = error instanceof Error ? error.message : '插入失败';
    }
    finally { if (revision === this.lifecycleRevision) this.inserting = false; }
  }

  private searchKey(event: KeyEvent): boolean {
    if (event.type !== KeyType.Down) return false;
    if (event.keyCode === 2070) { if (!this.inserting) this.onClose(); return true; }
    if ([2012, 2013].includes(event.keyCode) && this.results.length > 0 && !this.loading) {
      this.pointerActive = false;
      this.activeIndex = Math.max(0, Math.min(this.results.length - 1, this.activeIndex + (event.keyCode === 2013 ? 1 : -1)));
      this.scroller.scrollToIndex(this.activeIndex);
      return true;
    }
    if (event.keyCode === 2054 && this.activeIndex >= 0 && !this.loading) {
      this.insert(this.results[this.activeIndex]); return true;
    }
    return false;
  }

  @Builder
  private searchInput() {
      SearchField({ value: this.query, placeholder: '搜索日期、小节标题或正文', loading: this.loading,
        compact: true, showSubmit: false, focusKey: 'editor_link_search',
        onSearchKey: (event: KeyEvent) => this.searchKey(event),
        onChange: (value: string) => { this.query = value; this.search(); }, onSubmit: () => {
          if (this.activeIndex >= 0 && !this.loading) this.insert(this.results[this.activeIndex]);
          else this.search();
        },
        onClear: () => { this.query = ''; this.search(); } })
  }

  @Builder
  private aliasInput() {
      TextInput({ text: this.alias, placeholder: '显示文字（默认用目标标题）' })
        .monopolizeEvents(true)
        .id('editor_link_alias').height(40).fontSize(13).fontColor($r('app.color.ink'))
        .placeholderFont({ size: 13 }).placeholderColor($r('app.color.muted'))
        .backgroundColor($r('app.color.surface_soft')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
        .onChange((value: string) => this.alias = value)
  }

  build() {
      Column() {
        if (this.breakpoint === WorkspaceBreakpoint.COMPACT) {
          Column({ space: 4 }) {
            ActionPanelHeader({ title: '插入内部链接', closeLabel: '关闭内部链接选择器', showDragBar: true,
              onClose: () => { if (!this.inserting) this.onClose(); } })
            Text('选择日志或小节，自动生成跳转语法。').fontSize(12).fontColor($r('app.color.muted'))
              .width('100%')
          }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 12 })
            .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        } else {
        Row({ space: 12 }) {
          Image($r('app.media.link_2')).width(38).height(38).padding(9).colorFilter(iconTint($r('app.color.primary')))
            .backgroundColor($r('app.color.surface_soft')).border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6)
          Column({ space: 3 }) {
            Text('插入内部链接').fontFamily(workspaceSerifFamily(this.breakpoint)).fontSize(26).fontWeight(600)
              .fontColor($r('app.color.ink'))
            Text('选择日志或小节，自动生成跳转语法。').fontSize(12).fontColor($r('app.color.muted'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([$r('app.color.muted')])
          }.id('editor_link_close').width(36).height(36).padding(0).borderRadius(6)
            .backgroundColor($r('app.color.surface_soft')).border({ width: 1, color: $r('app.color.hairline') })
            .accessibilityText('关闭内部链接选择器').bindTips('关闭内部链接选择器', WORKSPACE_TIPS)
            .enabled(!this.inserting).onClick(() => this.onClose())
        }.width('100%').padding({ left: 20, right: 20, top: 18, bottom: 18 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        }
        Flex({ direction: this.narrow ? FlexDirection.Column : FlexDirection.Row, space: { main: LengthMetrics.vp(10) } }) {
          Column() { this.searchInput() }.width(this.narrow || this.initialAlias ? '100%' : '65%')
            .flexShrink(1)
          if (!this.initialAlias) {
            Column() { this.aliasInput() }.width(this.narrow ? '100%' : '35%').flexShrink(1)
          }
        }.width('100%').height(this.narrow && !this.initialAlias ? 118 : 68)
          .padding({ left: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 20,
            right: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 16 : 20, top: 14, bottom: 14 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
        InlineStatus({ text: this.error, error: true })
      if (this.loading && this.results.length === 0) {
        LoadingProgress().width(24).height(24).color($r('app.color.primary')).margin(16)
      }
      if (!this.loading && this.results.length === 0 && !this.error) {
        Text('未找到匹配的日志或小节').fontSize(13).fontColor($r('app.color.muted')).padding(16)
      }
      List({ scroller: this.scroller }) {
        ForEach(this.results, (candidate: EditorLinkCandidate, index: number) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Image(candidate.kind === 'day' ? $r('app.media.calendar_days') : $r('app.media.tab_file_text'))
                  .width(32).height(32).padding(7).colorFilter(iconTint($r('app.color.primary')))
                  .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(6)
                Column({ space: 3 }) {
                  Row({ space: 8 }) {
                    Text(candidate.heading || `${candidate.date} 日志`).fontSize(13).fontWeight(FontWeight.Medium)
                      .fontColor($r('app.color.body_strong')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                      .layoutWeight(1).textAlign(TextAlign.Start)
                    Text(candidate.date).fontSize(11).fontColor($r('app.color.muted')).textAlign(TextAlign.End)
                      .id(`editor_link_date_${index}`)
                  }.width('100%')
                  Text(candidate.preview).fontSize(12).fontColor($r('app.color.muted')).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%').textAlign(TextAlign.Start)
                }.layoutWeight(1)
                if (this.breakpoint !== WorkspaceBreakpoint.COMPACT) {
                  Text('插入').width(28).fontSize(12).fontWeight(600).fontColor($r('app.color.primary_active'))
                    .opacity(this.activeIndex === index ? 1 : 0)
                }
              }.width('100%')
            }.id(`editor_link_result_${index}`).width('100%').constraintSize({ minHeight: 66 })
              .padding({ left: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 8 : 11,
                right: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 8 : 11, top: 9, bottom: 9 }).borderRadius(6)
              .backgroundColor(this.activeIndex === index ? $r('app.color.surface_soft') : Color.Transparent)
              .enabled(!this.inserting && !this.loading)
              .onHover((hover: boolean) => {
                if (hover) { this.pointerActive = true; this.activeIndex = index; }
                else if (this.pointerActive && this.activeIndex === index) this.activeIndex = -1;
              })
              .onClick(() => this.insert(candidate))
          }
        }, (candidate: EditorLinkCandidate, index: number) => `${JSON.stringify(candidate)}:${index}`)
      }.layoutWeight(1).width('100%').padding(8).scrollBar(BarState.Auto)
      }.width('100%').height('100%')
        .backgroundColor($r('app.color.canvas')).border({ width: 1, color: $r('app.color.hairline') })
        .borderRadius({ topLeft: 12, topRight: 12,
          bottomLeft: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12,
          bottomRight: this.breakpoint === WorkspaceBreakpoint.COMPACT ? 0 : 12 }).clip(true)
        .onAreaChange((_old, area) => this.narrow = Number(area.width) < 580)
        .onKeyEvent((event: KeyEvent) => {
          if (event.type !== KeyType.Down || event.keyCode !== 2070) return false;
          if (!this.inserting) this.onClose(); return true;
        })
  }
}

import { SearchField } from '../../common/ui/FormControls';
import { EmptyState } from '../../common/ui/FeedbackStates';
import { workspaceKey } from '../../common/ui/WorkspaceKeys';
import { KeyCode } from '@kit.InputKit';

export interface LogSearchResult {
  date: string;
  month: string;
  fileName: string;
  headings: string[];
  matches: string[];
}

export interface LogSearchResponse { results: LogSearchResult[]; }

@Component
export struct LogSearchPanel {
  @Prop query: string = '';
  @Prop headingsOnly: boolean = false;
  @Prop ignoreCase: boolean = true;
  @Prop loading: boolean = false;
  @Prop submitted: boolean = false;
  @Prop error: string = '';
  @Prop results: LogSearchResult[] = [];
  onClose: () => void = () => {};
  onQuery: (query: string) => void = () => {};
  onSearch: () => void = () => {};
  onHeadings: () => void = () => {};
  onCase: () => void = () => {};
  onSelect: (result: LogSearchResult) => void = () => {};
  @State private activeIndex: number = -1;

  private searchKey(event: KeyEvent): boolean {
    if (workspaceKey(event, KeyCode.KEYCODE_ESCAPE)) { this.onClose(); return true; }
    if (!this.results.length) return false;
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_DOWN)) {
      this.activeIndex = (this.activeIndex + 1) % this.results.length;
      return true;
    }
    if (workspaceKey(event, KeyCode.KEYCODE_DPAD_UP)) {
      this.activeIndex = this.activeIndex <= 0 ? this.results.length - 1 : this.activeIndex - 1;
      return true;
    }
    return false;
  }

  build() {
    Column() {
      Row() {
        Text('搜索全部日志').fontSize(18).fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.ink')).layoutWeight(1)
        Button('返回日志').fontSize(13).fontColor($r('app.color.body'))
          .backgroundColor($r('app.color.surface_soft')).onClick(() => this.onClose())
      }.width('100%').height(54).padding({ left: 16, right: 16 })
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
      Column({ space: 10 }) {
        SearchField({ value: this.query, placeholder: this.headingsOnly ? '搜索小节标题' : '搜索日志内容',
          loading: this.loading, onChange: (query: string) => { this.activeIndex = -1; this.onQuery(query); },
          onSubmit: () => {
            if (this.activeIndex >= 0 && this.activeIndex < this.results.length) this.onSelect(this.results[this.activeIndex]);
            else { this.activeIndex = -1; this.onSearch(); }
          }, onClear: () => { this.activeIndex = -1; this.onQuery(''); },
          onSearchKey: (event: KeyEvent) => this.searchKey(event) })
        Row({ space: 8 }) {
          Button(this.headingsOnly ? '仅标题 ✓' : '全文').fontSize(12)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .onClick(() => { this.activeIndex = -1; this.onHeadings(); })
          Button(this.ignoreCase ? '忽略大小写 ✓' : '区分大小写').fontSize(12)
            .fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .onClick(() => { this.activeIndex = -1; this.onCase(); })
        }.width('100%')
      }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
      if (this.error) {
        Row() {
          Text(this.error).fontSize(13).fontColor($r('app.color.error')).layoutWeight(1)
          Button('重试').fontSize(12).onClick(() => this.onSearch())
        }.width('100%').padding(16)
      } else if (this.loading) {
        Row({ space: 8 }) {
          LoadingProgress().width(20).height(20).color($r('app.color.primary'))
          Text('正在搜索').fontSize(13).fontColor($r('app.color.muted'))
        }.layoutWeight(1).justifyContent(FlexAlign.Center)
      } else if (this.submitted && this.results.length === 0) {
        EmptyState({ symbol: $r('sys.symbol.magnifyingglass'),
          title: '未找到匹配内容', description: '换一个关键词再试试' })
      } else {
        List({ space: 6 }) {
          ForEach(this.results, (result: LogSearchResult, index: number) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Column({ space: 5 }) {
                  Text(result.date).fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.ink')).width('100%')
                  Text(result.matches[0] || result.headings[0] || '')
                    .fontSize(12).fontColor($r('app.color.muted')).maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                }.alignItems(HorizontalAlign.Start).width('100%')
              }.width('100%').padding(12)
                .backgroundColor(this.activeIndex === index ?
                  $r('app.color.surface_card') : $r('app.color.primary_tint'))
                .border({ width: { left: 2 }, color: $r('app.color.primary') })
                .borderRadius(8).onClick(() => this.onSelect(result))
            }
          }, (result: LogSearchResult) => result.date)
        }.layoutWeight(1).width('100%').padding({ left: 16, right: 16, bottom: 16 })
          .scrollBar(BarState.Off)
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
  }
}

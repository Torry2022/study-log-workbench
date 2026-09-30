import { SearchField } from '../../common/ui/FormControls';
import { SearchPageHeader } from '../../common/ui/WorkspaceChrome';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { EmptyState, InlineStatus } from '../../common/ui/FeedbackStates';
import { workspaceKey } from '../../common/ui/WorkspaceKeys';
import { KeyCode } from '@kit.InputKit';
import { SearchHistoryList } from '../../app/components/SearchHistoryList';

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
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop query: string = '';
  @Prop headingsOnly: boolean = false;
  @Prop ignoreCase: boolean = true;
  @Prop loading: boolean = false;
  @Prop submitted: boolean = false;
  @Prop error: string = '';
  @Prop results: LogSearchResult[] = [];
  @Prop searchHistory: string[] = [];
  @Prop showHistory: boolean = false;
  onClose: () => void = () => {};
  onQuery: (query: string) => void = () => {};
  onSearch: () => void = () => {};
  onHeadings: () => void = () => {};
  onCase: () => void = () => {};
  onSelect: (result: LogSearchResult) => void = () => {};
  onHistorySelect: (query: string) => void = () => {};
  onHistoryRemove: (query: string) => void = () => {};
  onHistoryClear: () => void = () => {};
  @State private focusRevision: number = 0;
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
      SearchPageHeader({ title: '搜索全部日志', backLabel: '返回日志', onBack: () => this.onClose() })
      Row() {
        SearchField({ value: this.query, placeholder: this.headingsOnly ? '搜索小节标题' : '搜索日志内容',
          focusKey: 'global_log_search', focusRevision: this.focusRevision,
          showHeadingToggle: this.workspaceBreakpoint !== WorkspaceBreakpoint.COMPACT,
          headingOnly: this.headingsOnly,
          showCaseToggle: this.workspaceBreakpoint !== WorkspaceBreakpoint.COMPACT,
          caseSensitive: !this.ignoreCase,
          onHeadingToggle: () => { this.activeIndex = -1; this.onHeadings(); },
          onCaseToggle: () => { this.activeIndex = -1; this.onCase(); },
          loading: this.loading, onChange: (query: string) => { this.activeIndex = -1; this.onQuery(query); },
          onSubmit: () => {
            if (this.activeIndex >= 0 && this.activeIndex < this.results.length) this.onSelect(this.results[this.activeIndex]);
            else { this.activeIndex = -1; this.onSearch(); }
          }, onClear: () => { this.activeIndex = -1; this.onQuery(''); },
          onSearchKey: (event: KeyEvent) => this.searchKey(event) }).onAppear(() => this.focusRevision++)
      }.width('100%').padding({ left: 14, right: 14, top: 12, bottom: 8 })
      if (this.showHistory) {
        Column() { SearchHistoryList({ searchHistory: this.searchHistory, listHeight: 400,
          onSelect: this.onHistorySelect, onRemove: this.onHistoryRemove,
          onClear: this.onHistoryClear }) }.width('100%').padding({ left: 14, right: 14 }).layoutWeight(1)
      } else if (this.error) {
        InlineStatus({ text: this.error, error: true, retry: true, onRetry: () => this.onSearch() })
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
                    .fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                }.alignItems(HorizontalAlign.Start).width('100%')
              }.width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 })
                .backgroundColor(this.activeIndex === index ?
                  $r('app.color.surface_card') : $r('app.color.primary_tint'))
                .border({ width: { left: 2 }, color: $r('app.color.primary') })
                .borderRadius(8).clip(true).onClick(() => this.onSelect(result))
            }
          }, (result: LogSearchResult) => result.date)
        }.layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 4, bottom: 20 })
          .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
  }
}

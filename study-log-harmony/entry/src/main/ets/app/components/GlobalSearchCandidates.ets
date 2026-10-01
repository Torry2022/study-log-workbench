import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { SearchHistoryList } from './SearchHistoryList';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { LogSearchResult as SearchResult } from '../../features/logs/LogSearchPanel';

@Component
export struct GlobalSearchCandidates {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop searchHistory: string[] = [];
  @Prop searchResults: SearchResult[] = [];
  @Prop searchActiveIndex: number = -1;
  @Prop showHistory: boolean = false;
  @Prop searchLoading: boolean = false;
  @Prop searchError: string = '';
  @Prop candidatesHeight: number = 66;
  @State private hoveredSearchResult: string = '';
  searchResultScroller: Scroller = new Scroller();
  onResultSelect: (result: SearchResult) => void = () => {};
  onHistorySelect: (query: string) => void = () => {};
  onHistoryRemove: (query: string) => void = () => {};
  onHistoryClear: () => void = () => {};
  onRetry: () => void = () => {};

  build() {
    Column() {
      if (this.showHistory) {
        SearchHistoryList({
          searchHistory: this.searchHistory, searchActiveIndex: this.searchActiveIndex,
          listHeight: this.candidatesHeight - 18, searchResultScroller: this.searchResultScroller,
          onSelect: this.onHistorySelect, onRemove: this.onHistoryRemove, onClear: this.onHistoryClear
        })
      } else if (this.searchLoading) {
        Row({ space: 8 }) {
          LoadingProgress().width(16).height(16).color($r('app.color.primary'))
          Text('正在搜索').fontSize(12).fontColor($r('app.color.muted'))
        }.width('100%').height(48).justifyContent(FlexAlign.Center)
      } else if (this.searchError) {
        Row() {
          Text(this.searchError).layoutWeight(1).fontSize(12).fontColor($r('app.color.error'))
          Button('重试', { type: ButtonType.Normal }).height(36).padding({ left: 12, right: 12 })
            .fontSize(12).fontColor($r('app.color.body')).backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
            .onClick(() => this.onRetry())
        }.width('100%').padding(12)
      } else if (this.searchResults.length === 0) {
        Text('未找到匹配内容').width('100%').padding(14).fontSize(12)
          .fontColor($r('app.color.muted')).textAlign(TextAlign.Center)
      } else {
        List({ space: 6, scroller: this.searchResultScroller }) {
          ForEach(this.searchResults, (result: SearchResult, index: number) => {
            ListItem() {
              Button({ type: ButtonType.Normal, stateEffect: false }) {
                Column({ space: 4 }) {
                  Text(result.date).width('100%').fontSize(14).lineHeight(22).fontWeight(600)
                    .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
                    .fontColor($r('app.color.ink')).textAlign(TextAlign.Start)
                  Text(result.matches.length > 0 ? result.matches[0] : result.headings[0] || '')
                    .width('100%').fontSize(12).lineHeight(18).fontColor($r('app.color.muted')).maxLines(1)
                    .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Start)
                }.width('100%').alignItems(HorizontalAlign.Start)
              }
              .width('100%').height(64).padding({ left: 10, right: 10, top: 9, bottom: 9 })
              .attributeModifier(new InteractiveSurface(this.searchActiveIndex === index ?
                $r('app.color.primary_tint_strong') : $r('app.color.primary_tint'),
                this.hoveredSearchResult === result.date, this.searchActiveIndex === index))
              .border({ width: { left: 2, right: 1, top: 1, bottom: 1 }, color: {
                left: $r('app.color.primary'),
                right: this.searchActiveIndex === index ? $r('app.color.search_toggle_active_border') : Color.Transparent,
                top: this.searchActiveIndex === index ? $r('app.color.search_toggle_active_border') : Color.Transparent,
                bottom: this.searchActiveIndex === index ? $r('app.color.search_toggle_active_border') : Color.Transparent
              } }).borderRadius(8)
              .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredSearchResult = hover ? result.date : ''))
              .id(`global_search_result_${index}`).accessibilitySelected(this.searchActiveIndex === index)
              .onClick(() => this.onResultSelect(result))
            }
          }, (result: SearchResult) => result.date)
        }.width('100%').height(this.candidatesHeight - 18).scrollBar(BarState.Auto)
      }
    }.width('100%')
  }
}

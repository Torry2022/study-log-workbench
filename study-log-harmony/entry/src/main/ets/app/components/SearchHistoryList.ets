import { InteractiveSurface, animateHover } from '../../common/ui/InteractiveSurface';
import { WorkspaceBreakpoint } from '../../common/AppConfig';
import { workspaceSansFamily } from '../../common/ui/Typography';
import { iconTint } from '../../common/ui/IconTint';

@Component
export struct SearchHistoryList {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop searchHistory: string[] = [];
  @Prop searchActiveIndex: number = -1;
  @Prop listHeight: number = 0;
  @State private hoveredSearchResult: string = '';
  searchResultScroller: Scroller = new Scroller();
  onSelect: (query: string) => void = () => {};
  onRemove: (query: string) => void = () => {};
  onClear: () => void = () => {};

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  build() {
    Column() {
      Row() {
        Text('最近搜索').fontSize(12).fontWeight(600).fontColor($r('app.color.muted')).layoutWeight(1)
        Button('清除', { type: ButtonType.Normal, stateEffect: false })
          .id('search_history_clear').fontSize(12).fontColor($r('app.color.muted'))
          .height(30).padding({ left: 8, right: 8 }).backgroundColor(Color.Transparent)
          .onClick(() => { this.onClear(); })
      }.width('100%').height(32).padding({ left: 8 })
      List({ scroller: this.searchResultScroller }) {
        ForEach(this.searchHistory, (item: string, index: number) => {
          ListItem() {
            Row() {
              Button({ type: ButtonType.Normal, stateEffect: false }) {
                Row({ space: 12 }) {
                  Image($r('app.media.history')).width(14).height(14).colorFilter(iconTint($r('app.color.muted')))
                  Text(item).fontSize(14).fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
                    .fontColor($r('app.color.ink')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1).textAlign(TextAlign.Start)
                }.width('100%')
              }.id(`search_history_item_${index}`).accessibilitySelected(this.searchActiveIndex === index)
                .layoutWeight(1).height(40).padding({ left: 10, right: 4 }).backgroundColor(Color.Transparent)
                .onClick(() => this.onSelect(item))
              Button({ type: ButtonType.Normal, stateEffect: false }) {
                SymbolGlyph($r('sys.symbol.xmark')).fontSize(12).fontColor([$r('app.color.muted')])
              }.id(`search_history_delete_${index}`).accessibilityText(`删除搜索记录：${item}`)
                .width(32).height(32).padding(0).backgroundColor(Color.Transparent)
                .opacity(!this.isLargeWorkspace() || this.hoveredSearchResult === item || this.searchActiveIndex === index ? 1 : 0)
                .onClick(() => this.onRemove(item))
            }.width('100%').height(40).borderRadius(8)
              .attributeModifier(new InteractiveSurface(this.searchActiveIndex === index ? $r('app.color.surface_card') :
                Color.Transparent, this.hoveredSearchResult === item, this.searchActiveIndex === index))
              .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredSearchResult = hover ? item : ''))
          }
        }, (item: string) => item)
      }.width('100%').layoutWeight(1).scrollBar(BarState.Auto)
    }.width('100%').height(this.listHeight)
  }
}

import { appFeedback } from './AppFeedback';

@Component
export struct NavigationRefresh {
  @BuilderParam content: () => void;
  onRefresh: () => Promise<void> = async () => {};
  @State private refreshing: boolean = false;
  @State private status: RefreshStatus = RefreshStatus.Inactive;
  private alive: boolean = true;
  private inFlight: boolean = false;

  aboutToAppear(): void { this.alive = true; }
  aboutToDisappear(): void { this.alive = false; }

  private async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.refreshing = true;
    try {
      await this.onRefresh();
      if (this.alive) appFeedback.dismissScope('navigation-refresh');
    } catch (_) {
      if (this.alive) appFeedback.show('导航刷新失败，已保留原列表，请下拉重试', 'error', 3600, 'navigation-refresh');
    } finally {
      this.inFlight = false;
      if (this.alive) this.refreshing = false;
    }
  }

  @Builder
  private indicator() {
    Row({ space: 8 }) {
      if (this.refreshing) {
        LoadingProgress().width(18).height(18).color($r('app.color.primary'))
      } else {
        SymbolGlyph($r('sys.symbol.arrow_down')).fontSize(18).fontColor([$r('app.color.muted')])
      }
      Text(this.refreshing ? '正在刷新…' : (this.status === RefreshStatus.OverDrag ? '松开刷新' : '下拉刷新'))
        .fontSize(12).fontColor($r('app.color.muted'))
    }.height(48).width('100%').justifyContent(FlexAlign.Center)
  }

  build() {
    Refresh({ refreshing: $$this.refreshing, builder: this.indicator }) {
      this.content()
    }
    .id('navigation_refresh').width('100%').layoutWeight(1)
    .pullToRefresh(true).pullDownRatio(0.5)
    .refreshOffset(64)
    .onStateChange((status: RefreshStatus) => this.status = status)
    .onRefreshing(() => this.refresh())
  }
}

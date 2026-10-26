import { ContentRefresh } from './ContentRefresh';

@Component
export struct NavigationRefresh {
  @BuilderParam content: () => void;
  onRefresh: () => Promise<void> = async () => {};

  build() {
    ContentRefresh({ refreshId: 'navigation_refresh', extendBottomSafeArea: true, feedbackScope: 'navigation-refresh',
      failureText: '导航刷新失败，已保留原列表，请下拉重试',
      onRefresh: this.onRefresh, content: this.content })
  }
}

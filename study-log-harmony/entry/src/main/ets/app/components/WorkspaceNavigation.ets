import { TabDefinition, WORKSPACE_TABS, WorkspaceBreakpoint } from '../../common/AppConfig';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { workspaceSansFamily } from '../../common/ui/Typography';

@Component
export struct AppTopBar {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop title: string = '学习日志';
  @Prop showSearch: boolean = true;
  @Prop showDivider: boolean = false;
  onOpenNavigation: () => void = () => {};
  onOpenSearch: () => void = () => {};
  onOpenMore: () => void = () => {};

  @Builder
  private imageButton(icon: Resource, label: string, action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Image(icon)
        .width(20)
        .height(20)
        .objectFit(ImageFit.Contain)
    }
    .id(label === '打开导航' ? 'workspace_navigation_open' : '')
    .width(42)
    .height(42)
    .padding(0)
    .borderRadius(8)
    .clip(true)
    .backgroundColor(Color.Transparent)
    .accessibilityText(label)
    .bindTips(label, WORKSPACE_TIPS)
    .onClick(action)
  }

  @Builder
  private moreButton(action: () => void) {
    Button({ type: ButtonType.Normal }) {
      Image($r('app.media.more_horizontal'))
        .width(20)
        .height(20)
        .fillColor($r('app.color.ink'))
        .objectFit(ImageFit.Contain)
    }
    .width(42)
    .height(42)
    .padding(0)
    .borderRadius(8)
    .clip(true)
    .backgroundColor(Color.Transparent)
    .accessibilityText('更多设置').bindTips('更多设置', WORKSPACE_TIPS)
    .id('workspace_more_settings')
    .onClick(action)
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Row({ space: 6 }) {
        this.imageButton($r('app.media.menu'), '打开导航', this.onOpenNavigation)

        Row() {
          Text(this.title)
            .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
            .fontSize(17)
            .lineHeight(22)
            .fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.ink'))
            .maxLines(1)
        }
        .height(42)
        .alignItems(VerticalAlign.Center)
        .layoutWeight(1)

        Row({ space: 1 }) {
          if (this.showSearch) {
            this.imageButton($r('app.media.search'), '搜索', this.onOpenSearch)
          }
          this.moreButton(this.onOpenMore)
        }
      }
      .width('100%')
      .height(44)
      .alignItems(VerticalAlign.Center)
      .padding({ left: 7, right: 7 })

      Divider()
        .width('100%')
        .strokeWidth(1)
        .color($r('app.color.hairline'))
        .opacity(this.showDivider ? 1 : 0)
    }
    .width('100%')
    .height(44)
    .backgroundColor($r('app.color.canvas'))
  }
}
@Component
export struct BottomNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop selectedIndex: number = 0;
  onSelect: (index: number) => void = () => {};

  @Builder
  private item(tab: TabDefinition, index: number) {
    Button({ type: ButtonType.Normal, stateEffect: false }) {
      Column({ space: 3 }) {
        Image(this.selectedIndex === index ? tab.activeIcon : tab.icon)
          .width(20)
          .height(20)
          .objectFit(ImageFit.Contain)
        Text(tab.label)
          .fontFamily(workspaceSansFamily(this.workspaceBreakpoint))
          .fontSize(10)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.selectedIndex === index ? $r('app.color.primary_active') : $r('app.color.muted'))
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
      .height('100%')
    }
    .layoutWeight(1)
    .height(52)
    .padding(0)
    .borderRadius(8)
    .backgroundColor(this.selectedIndex === index ? $r('app.color.primary_tint') : Color.Transparent)
    .id(`workspace_tab_${index}`)
    .onClick(() => this.onSelect(index))
  }

  build() {
    Row({ space: 4 }) {
      ForEach(WORKSPACE_TABS, (tab: TabDefinition, index: number) => {
        this.item(tab, index)
      }, (tab: TabDefinition) => tab.label)
    }
    .width('100%')
    .height(64)
    .padding({ left: 8, right: 8, top: 5, bottom: 5 })
    .backgroundColor($r('app.color.canvas'))
    .border({ width: { top: 1 }, color: $r('app.color.hairline') })
  }
}

import { BottomNavigation } from './WorkspaceNavigation';
import { WorkspaceTransitionCoordinator } from '../WorkspaceTransitionCoordinator';

// Layout ownership follows Index.workspace in the personal client; feature content stays in its slots.
@Component
export struct WorkspaceFrame {
  @Prop wide: boolean = false;
  @Prop readingMode: boolean = false;
  @Prop readingProgress: number = 0;
  @Prop readingAnimating: boolean = false;
  @Prop sidebarWidth: number = 220;
  @Prop sidebarPopover: boolean = false;
  @Prop keyboardVisible: boolean = false;
  @Prop selectedModule: number = 0;
  @ObjectLink coordinator: WorkspaceTransitionCoordinator;
  @BuilderParam desktopTopBar: () => void;
  @BuilderParam compactTopBar: () => void;
  @BuilderParam navigation: () => void;
  @BuilderParam content: () => void;
  onSelect: (index: number) => void = () => {};
  onContentArea: (area: Area) => void = () => {};
  onWorkspaceArea: (area: Area) => void = () => {};

  build() {
    Column() {
      if (this.wide) {
        Stack({ alignContent: Alignment.Top }) {
          Column() { this.desktopTopBar() }.width('100%').height(64)
            .translate({ y: -64 * this.readingProgress })
        }.width('100%').height(64 * (1 - this.readingProgress))
          .zIndex(30)
          .clip(this.readingAnimating || this.readingMode)
          .hitTestBehavior(this.readingMode ? HitTestMode.None : HitTestMode.Default)
          .accessibilityLevel(this.readingMode ? 'no-hide-descendants' : 'auto')
      } else if (!this.readingMode) {
        this.compactTopBar()
      }
      Stack() {
        Row() {
          if (this.wide) {
            Stack({ alignContent: Alignment.TopStart }) {
              Column() { this.navigation() }.width(this.sidebarWidth).height('100%')
                .translate({ x: -this.sidebarWidth * this.readingProgress })
            }.width(this.sidebarWidth * (1 - this.readingProgress)).height('100%')
              .clip(this.readingAnimating || this.readingMode)
              .zIndex(this.sidebarPopover ? 40 : 1)
              .hitTestBehavior(this.readingMode ? HitTestMode.None : HitTestMode.Default)
              .accessibilityLevel(this.readingMode ? 'no-hide-descendants' : 'auto')
          }
          this.content()
        }.width('100%').height('100%')
          .onAreaChange((_old: Area, area: Area) => this.onContentArea(area))
        if (this.coordinator.snapshot && this.coordinator.kind === 'module') {
          Image(this.coordinator.snapshot).width('100%').height('100%')
            .objectFit(ImageFit.Fill).syncLoad(true).opacity(this.coordinator.opacity).zIndex(10)
            .onComplete(() => this.coordinator.rendered())
            .onError(() => this.coordinator.clear())
            .hitTestBehavior(HitTestMode.None)
        }
      }.id('module_frame').focusable(true).layoutWeight(1).width('100%')
      if (!this.wide && !this.keyboardVisible) {
        BottomNavigation({ selectedIndex: this.selectedModule, onSelect: (index: number) => this.onSelect(index) })
          .id('workspace_bottom_navigation')
      }
    }.width('100%').height('100%').backgroundColor($r('app.color.canvas'))
      .id('workspace_frame')
      .hitTestBehavior(this.readingAnimating ? HitTestMode.None : HitTestMode.Default)
      .onAreaChange((_old: Area, area: Area) => this.onWorkspaceArea(area))
  }
}

import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { MonthSummary } from '../../logs/LogModels';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { NavigationRowStyle, NavigationLabelStyle, NavigationCountStyle } from '../../../common/ui/NavigationRowStyle';

@Component
export struct StatsNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop monthsOnly: boolean = false;
  @Prop statsMonths: MonthSummary[] = [];
  @Prop statsMonth: string = '';
  @Prop statsMonthsLoading: boolean = false;
  @Prop statsMonthsError: string = '';
  @State private hoveredNavigation: string = '';
  onTaxonomy: () => void = () => {};
  onRetry: () => void = () => {};
  onMonth: (month: string) => void = () => {};

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  build() {
    List({ space: 12 }) {
      if (!this.monthsOnly) {
      ListItem() {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            Image($r('app.media.settings_2')).width(16).height(16).objectFit(ImageFit.Contain)
            Text('分类管理').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          }.justifyContent(FlexAlign.Center)
        }
        .width('100%').height(40).padding(0).backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .onClick(() => this.onTaxonomy())
      }
      }
      ListItem() {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
          Text('统计月份').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).layoutWeight(1)
          Text(`${this.statsMonths.length} 个月`).fontSize(11).fontColor($r('app.color.muted_soft'))
        }.width('100%')
      }
      if (this.statsMonthsLoading) {
        ListItem() {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.primary'))
            Text('正在读取统计月份').fontSize(12).fontColor($r('app.color.muted'))
          }.width('100%').height(52).justifyContent(FlexAlign.Center)
        }
      } else if (this.statsMonthsError) {
        ListItem() {
          InlineStatus({ text: this.statsMonthsError, error: true, retry: true,
            onRetry: () => this.onRetry() })
        }
      } else if (this.statsMonths.length === 0) {
        ListItem() {
          Text('暂无统计月份').fontSize(12).fontColor($r('app.color.muted'))
            .width('100%').height(52).textAlign(TextAlign.Center)
        }
      } else {
        ListItem() {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            ForEach(this.statsMonths, (month: MonthSummary) => {
              Button({ type: ButtonType.Normal }) {
                Row() {
                  Text(month.label).fontSize(this.isLargeWorkspace() ? 14 : 12).fontWeight(FontWeight.Medium)
                    .attributeModifier(new NavigationLabelStyle(this.statsMonth === month.id, this.isLargeWorkspace()))
                    .fontColor(this.statsMonth === month.id ? $r('app.color.ink') : $r('app.color.body'))
                    .layoutWeight(1)
                  Text(month.dayCount.toString()).fontSize(this.isLargeWorkspace() ? 12 : 11).fontColor($r('app.color.muted_soft'))
                    .attributeModifier(new NavigationCountStyle(this.isLargeWorkspace()))
                }.width('100%')
              }
              .width(this.isLargeWorkspace() ? '100%' : '48.5%').height(44)
              .padding({ left: 10, right: 10 }).margin({ bottom: this.isLargeWorkspace() ? 4 : 7 })
              .attributeModifier(new InteractiveSurface(this.isLargeWorkspace() ?
                (this.statsMonth === month.id ? $r('app.color.surface_card') : Color.Transparent) :
                (this.statsMonth === month.id ? $r('app.color.primary_tint') : $r('app.color.surface_card')), this.hoveredNavigation === `stats-${month.id}`, this.statsMonth === month.id))
              .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `stats-${month.id}` : ''))
              .border({ width: this.isLargeWorkspace() ? 0 : 1, color: this.statsMonth === month.id ? $r('app.color.primary') : $r('app.color.hairline') })
              .borderRadius(8).clip(true)
              .onClick(() => this.onMonth(month.id))
              .attributeModifier(new NavigationRowStyle(this.isLargeWorkspace()))
              .id(`stats_month_${month.id}`).accessibilitySelected(this.statsMonth === month.id)
            }, (month: MonthSummary) => month.id)
          }.width('100%')
        }
      }
    }
    .layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 14, bottom: 28 })
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
  }
}

import { MonthNavigationGroups, NavigationMonthOption } from '../../../common/ui/MonthNavigationGroups';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { MonthSummary } from '../../logs/LogModels';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { NavigationSectionStyle } from '../../../common/ui/NavigationRowStyle';

@Component
export struct StatsNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop monthsOnly: boolean = false;
  @Prop statsMonths: MonthSummary[] = [];
  @Prop statsMonth: string = '';
  @Prop statsMonthsLoading: boolean = false;
  @Prop statsMonthsError: string = '';
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
          Text('月份').attributeModifier(new NavigationSectionStyle()).layoutWeight(1)
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
          MonthNavigationGroups({ months: this.statsMonths.map((month: MonthSummary): NavigationMonthOption => ({
            id: month.id, label: month.label, count: month.dayCount })),
            selectedMonth: this.statsMonth, wide: this.isLargeWorkspace(), rowPrefix: 'stats_month',
            onMonth: this.onMonth })
        }
      }
    }
    .layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 14, bottom: 28 })
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
  }
}

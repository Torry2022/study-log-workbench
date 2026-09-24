import { LengthMetrics } from '@kit.ArkUI';
import { DaySummary, MonthSummary } from '../LogModels';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { NavigationRowStyle, NavigationLabelStyle, NavigationCountStyle } from '../../../common/ui/NavigationRowStyle';
import { InlineStatus } from '../../../common/ui/FeedbackStates';
import { SearchField } from '../../../common/ui/FormControls';

@Component
export struct LogNavigation {
  @Consume('workspaceBreakpoint') private workspaceBreakpoint: WorkspaceBreakpoint;
  @Prop navigationMonths: MonthSummary[] = [];
  @Prop navigationDays: DaySummary[] = [];
  @Prop navigationMonth: string = '';
  @Prop requestedDate: string = '';
  @Prop navigationMonthsExpanded: boolean = false;
  @Prop navigationDayQuery: string = '';
  @Prop navigationLoading: boolean = false;
  @Prop navigationError: string = '';
  @State private hoveredNavigation: string = '';
  logNavigationScroller: Scroller = new Scroller();
  @BuilderParam dateActions: () => void = this.emptyContent;
  @BuilderParam jumpDatePicker: () => void = this.emptyContent;
  onMonth: (month: string) => void = () => {};
  onDay: (date: string) => void = () => {};
  onHeading: (day: DaySummary, heading: string, index: number) => void = () => {};
  onQuery: (query: string) => void = () => {};
  onToggleMonths: () => void = () => {};
  onRetry: () => void = () => {};

  @Builder
  private emptyContent() {}

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  private filteredNavigationDays(): DaySummary[] {
    const query = this.navigationDayQuery.trim().toLowerCase();
    if (!query) return this.navigationDays;
    return this.navigationDays.filter((day: DaySummary) =>
      day.headings.some((heading: string) => heading.toLowerCase().includes(query))
    );
  }

  build() {
    List({ space: this.isLargeWorkspace() ? 8 : 12, scroller: this.logNavigationScroller }) {
      if (!this.isLargeWorkspace()) {
        ListItem() {
          this.dateActions()
        }
      }
      ListItem() {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
          Text('月份').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted'))
        }.width('100%')
      }
      ListItem() {
        Flex({ wrap: FlexWrap.Wrap,
          justifyContent: this.isLargeWorkspace() ? FlexAlign.Start : FlexAlign.SpaceBetween }) {
          ForEach(this.navigationMonthsExpanded ? this.navigationMonths : this.navigationMonths.slice(0, 6), (month: MonthSummary) => {
            Button({ type: ButtonType.Normal }) {
              Row() {
                Text(month.label).fontSize(this.isLargeWorkspace() ? 14 : 12).fontWeight(FontWeight.Medium)
                  .attributeModifier(new NavigationLabelStyle(this.navigationMonth === month.id, this.isLargeWorkspace()))
                  .fontColor(this.navigationMonth === month.id ? $r('app.color.ink') : $r('app.color.body'))
                  .layoutWeight(1)
                Text(month.dayCount.toString()).fontSize(11).fontColor($r('app.color.muted_soft'))
                  .attributeModifier(new NavigationCountStyle(this.isLargeWorkspace()))
              }.width('100%')
            }
            .width(this.isLargeWorkspace() ? '100%' : '48.5%')
            .height(this.isLargeWorkspace() ? 36 : 44)
            .padding({ left: 10, right: 10 }).margin({ bottom: this.isLargeWorkspace() ? 4 : 7 })
            .attributeModifier(new InteractiveSurface(this.navigationMonth === month.id ? $r('app.color.surface_card') :
              $r('app.color.surface_soft'), this.hoveredNavigation === `log-month-${month.id}`, this.navigationMonth === month.id))
            .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `log-month-${month.id}` : ''))
            .border({ width: 0 })
            .borderRadius(this.isLargeWorkspace() ? 6 : 8).clip(true)
            .attributeModifier(new NavigationRowStyle(this.isLargeWorkspace()))
            .onClick(() => {
              this.onMonth(month.id);
            })
          }, (month: MonthSummary) => `${month.id}:${month.dayCount}`)
          if (this.navigationMonths.length > 6) {
            Button({ type: ButtonType.Normal }) {
              Text(this.navigationMonthsExpanded ? '收起月份' : `展开其余 ${this.navigationMonths.length - 6} 个月份`)
                .width('100%').textAlign(TextAlign.Start)
                .fontSize(12).fontColor($r('app.color.muted'))
            }
              .id('navigation_months_toggle').width('100%').height(this.isLargeWorkspace() ? 28 : 40)
              .padding({ left: 10, right: 10 })
              .backgroundColor(Color.Transparent)
              .borderRadius(6).onClick(() => this.onToggleMonths())
          }
        }.width('100%')
          .height((this.isLargeWorkspace() ? 42 : 51) * Math.ceil(
            (this.navigationMonthsExpanded ? this.navigationMonths.length : Math.min(6, this.navigationMonths.length)) /
            (this.isLargeWorkspace() ? 1 : 2)) +
            (this.navigationMonths.length > 6 ? (this.isLargeWorkspace() ? 28 : 40) : 0))
          .clip(true)
      }
      ListItem() {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.doc_text')).fontSize(15).fontColor([$r('app.color.primary_active')])
          Text('日期').fontSize(12).fontWeight(FontWeight.Medium).fontColor($r('app.color.muted')).layoutWeight(1)
          this.jumpDatePicker()
        }.width('100%')
      }
      if (this.isLargeWorkspace()) {
        ListItem() {
          this.dateActions()
        }
      }
      ListItem() {
        SearchField({
          value: this.navigationDayQuery,
          placeholder: '按标题定位日期',
          compact: true,
          showSubmit: false,
          onChange: (value: string) => this.onQuery(value)
        })
      }
      if (this.navigationLoading) {
        ListItem() {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.primary'))
            Text('正在读取').fontSize(12).fontColor($r('app.color.muted'))
          }.width('100%').height(52).justifyContent(FlexAlign.Center)
        }
      } else if (this.navigationError) {
        ListItem() {
          InlineStatus({ text: this.navigationError, error: true, retry: true,
            onRetry: () => this.onRetry() })
        }
      } else if (this.filteredNavigationDays().length === 0) {
        ListItem() {
          Text(this.navigationDayQuery ? '未找到匹配标题' : '这个月还没有日志')
            .fontSize(12).fontColor($r('app.color.muted')).width('100%').padding(10)
        }
      } else {
        ListItemGroup({ space: this.isLargeWorkspace() ? 6 : 12 }) {
          ForEach(this.filteredNavigationDays(), (day: DaySummary) => {
            ListItem() {
              Column({ space: 8 }) {
                Text(this.navigationDayQuery ? day.date : day.date.slice(5))
                  .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink')).width('100%')
                Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(5), cross: LengthMetrics.vp(5) } }) {
                  if (day.headings.length === 0) {
                    Text('未命名').fontSize(12).fontColor($r('app.color.muted'))
                      .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                      .backgroundColor($r('app.color.surface_card')).borderRadius(12)
                  } else {
                    ForEach(day.headings, (heading: string, headingIndex: number) => {
                      Text(heading.replace(/^\d+\.\s*/, '')).fontSize(13).fontColor($r('app.color.body'))
                        .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                        .backgroundColor(this.requestedDate === day.date ?
                          $r('app.color.primary_tint_strong') : $r('app.color.primary_tint')).borderRadius(12)
                        .monopolizeEvents(true)
                        .onClick(() => this.onHeading(day, heading, headingIndex))
                    }, (heading: string, headingIndex: number) => `${heading}-${headingIndex}`)
                  }
                }.width('100%')
              }
              .width('100%').padding(10).alignItems(HorizontalAlign.Start)
              .attributeModifier(new InteractiveSurface(this.requestedDate === day.date ? $r('app.color.surface_card') : $r('app.color.surface_soft'), this.hoveredNavigation === `log-day-${day.date}`, this.requestedDate === day.date))
              .onHover((hover: boolean) => animateHover(this.getUIContext(), () => this.hoveredNavigation = hover ? `log-day-${day.date}` : ''))
              .border({ width: 0 })
              .borderRadius(8).clip(true)
              .id(`navigation_day_${day.date}`)
              .onClick(() => this.onDay(day.date))
            }
          }, (day: DaySummary) => day.date)
        }
      }
    }
    .layoutWeight(1).width('100%').padding({ left: 14, right: 14, top: 14 })
    .contentEndOffset(28)
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
  }

}

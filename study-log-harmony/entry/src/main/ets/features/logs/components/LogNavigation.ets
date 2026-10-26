import { MonthNavigationGroups, NavigationMonthOption } from '../../../common/ui/MonthNavigationGroups';
import { currentShanghaiYear } from '../../../common/ui/MonthNavigation';
import { LengthMetrics } from '@kit.ArkUI';
import { DaySummary, MonthSummary } from '../LogModels';
import { WorkspaceBreakpoint } from '../../../common/AppConfig';
import { InteractiveSurface, animateHover } from '../../../common/ui/InteractiveSurface';
import { NavigationRowStyle, NavigationSectionStyle } from '../../../common/ui/NavigationRowStyle';
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

  private collapsedMonths(): MonthSummary[] {
    if (this.navigationMonths.length <= 12) return this.navigationMonths;
    return this.navigationMonths.filter((month: MonthSummary) => month.id.startsWith(`${currentShanghaiYear()}-`) || month.id === this.navigationMonth);
  }

  private visibleMonths(): MonthSummary[] {
    return this.navigationMonthsExpanded ? this.navigationMonths : this.collapsedMonths();
  }

  private hiddenMonthCount(): number {
    return this.navigationMonths.length - this.collapsedMonths().length;
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
      ListItem() {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
          Text('月份').attributeModifier(new NavigationSectionStyle())
        }.width('100%')
      }
      ListItem() {
        Column({ space: 4 }) {
          MonthNavigationGroups({ months: this.visibleMonths().map((month: MonthSummary): NavigationMonthOption => ({
            id: month.id, label: month.label, count: month.dayCount })),
            selectedMonth: this.navigationMonth, wide: this.isLargeWorkspace(), rowPrefix: 'navigation_month',
            onMonth: this.onMonth })
          if (this.hiddenMonthCount() > 0) {
            Button({ type: ButtonType.Normal }) {
              Text(this.navigationMonthsExpanded ? '收起月份' : `展开剩余 ${this.hiddenMonthCount()} 个月份`)
                .fontSize(12).fontColor($r('app.color.muted'))
            }.id('navigation_months_toggle').height(this.isLargeWorkspace() ? 28 : 44)
              .padding({ left: 10, right: 10 }).backgroundColor(Color.Transparent).borderRadius(6)
              .onClick(() => this.onToggleMonths())
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }
      ListItem() {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.doc_text')).fontSize(15).fontColor([$r('app.color.primary_active')])
          Text('日期').attributeModifier(new NavigationSectionStyle()).layoutWeight(1)
          this.jumpDatePicker()
        }.width('100%')
      }
      ListItem() {
        this.dateActions()
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
      if (this.navigationError) {
        ListItem() {
          InlineStatus({ text: this.navigationError, error: true, retry: true,
            onRetry: () => this.onRetry() })
        }
      }
      if (this.navigationLoading && !this.navigationDays.some((day: DaySummary) => day.date.startsWith(`${this.navigationMonth}-`))) {
        ListItem() {
          Row({ space: 8 }) {
            LoadingProgress().width(18).height(18).color($r('app.color.primary'))
            Text('正在读取').fontSize(12).fontColor($r('app.color.muted'))
          }.width('100%').height(52).justifyContent(FlexAlign.Center)
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
                      Text(heading.replace(/^\d+\.\s*/, '')).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.body'))
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

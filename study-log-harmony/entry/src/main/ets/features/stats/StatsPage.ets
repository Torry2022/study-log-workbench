import { appFeedback } from '../../common/ui/AppFeedback';
import { LengthMetrics } from '@kit.ArkUI';
import { KeyCode } from '@kit.InputKit';
import { ActionPanelHeader, ModulePageHeader, SectionHeading } from '../../common/ui/WorkspaceChrome';
import { AppDropdown } from '../../common/ui/FormControls';
import { BackToTopControl } from '../../common/ui/BackToTopControl';
import { EmptyState, InlineStatus, LoadFailure } from '../../common/ui/FeedbackStates';
import { apiClient } from '../../common/network/ApiClient';
import { WorkspaceBreakpoint, COLLECTION_MAX_WIDTH } from '../../common/AppConfig';
import { ResultChangeGate } from '../../common/ui/WorkspaceMotion';
import { ResultSurfaceController, ResultSurfaceCover } from '../../common/ui/ResultSurface';
import { ContentLoadingState } from '../../common/ui/ContentLoadingState';
import { LoadingHintAnchor, LoadingHintPlacement } from '../../common/ui/LoadingHintAnchor';
import {
  workspaceLatinSerifFamily,
  workspaceSansFamily
} from '../../common/ui/Typography';
import { DomainCount, TagCount } from './StatsModels';
import { MonthSummary } from '../logs/LogModels';
import { StatsEntry, StatsResponse } from './StatsModels';
import { StatsController } from './StatsController';

@Component
export struct StatsPage {
  @Prop @Watch('topRequested') topRevision: number = 0;

  private topRequested(): void { if (this.topRevision > 0) this.scrollToTop(); }
  onLoadingHintChange: (placement: LoadingHintPlacement) => void = () => {};
  @Consume('workspaceBreakpoint') @Watch('calendarLayoutChanged') private workspaceBreakpoint: WorkspaceBreakpoint;
  @StorageProp('desktopWindowChrome') private desktopWindowChrome: boolean = false;
  @Prop @Watch('refreshRevisionChanged') refreshRevision: number = 0;
  @Prop requestedMonth: string = '';
  @Prop @Watch('requestedMonthChanged') requestedMonthRevision: number = 0;
  onOpenEntry: (entry: StatsEntry) => void = () => {};
  onOpenTaxonomyManager: () => void = () => {};
  @Prop showTaxonomyManager: boolean = false;
  onScrollStateChange: (scrolled: boolean) => void = () => {};
  onMonthsChange: (months: MonthSummary[]) => void = () => {};
  onMonthsLoadingChange: (loading: boolean) => void = () => {};
  onMonthsErrorChange: (error: string) => void = () => {};
  onSelectedMonthChange: (month: string) => void = () => {};
  onOpenLog: () => void = () => {};
  @State private resultSurface: ResultSurfaceController = new ResultSurfaceController();
  @State private drilldownKind: string = '';
  @State private drilldownValue: string = '';
  @State private calendarDetailsOpen: boolean = false;
  @State private calendarPopoverDate: string = '';
  @State private scrollOffset: number = 0;
  @State private scrollProgress: number = 0;
  @State private viewportHeight: number = 0;
  @State private viewportWidth: number = 0;
  private pageScroller: Scroller = new Scroller();
  private resultChanges: ResultChangeGate = new ResultChangeGate();
  private topToolsHeight: number = 0;

  @State private data: StatsController = new StatsController(apiClient, {
    requestedMonth: () => this.requestedMonth,
    monthsChanged: (months) => this.onMonthsChange(months),
    monthsLoading: (loading) => this.onMonthsLoadingChange(loading),
    monthsError: (message) => this.onMonthsErrorChange(message),
    selectedMonthChanged: (month) => this.onSelectedMonthChange(month),
    prepareResult: () => {
      this.resultChanges.reset(this.data.stats ? JSON.stringify(this.data.stats) : '');
      this.resultSurface.clear();
    },
    publishResult: (stats, commit, current) => this.publishStats(stats, commit, current)
  });

  private isLargeWorkspace(): boolean {
    return this.workspaceBreakpoint === WorkspaceBreakpoint.LARGE ||
      this.workspaceBreakpoint === WorkspaceBreakpoint.EXTRA_LARGE;
  }

  aboutToAppear(): void { this.loadMonths(); }

  aboutToDisappear(): void {
    this.resultChanges.reset('');
    this.resultSurface.clear();
    this.data.dispose();
  }

  private refreshRevisionChanged(): void {
    if (!this.data.loading) this.refreshStats();
  }

  private requestedMonthChanged(): void {
    if (this.requestedMonthRevision <= 0 || !this.requestedMonth || this.requestedMonth === (this.data.pendingMonth || this.data.selectedMonth)) return;
    this.loadStats(this.requestedMonth);
  }

  private async loadMonths(): Promise<boolean> { return this.data.loadMonths(); }

  private async loadStats(month: string): Promise<boolean> { return this.data.loadStats(month); }

  private publishStats(stats: StatsResponse, commit: () => void, current: () => boolean): void {
    const previousKey = this.data.stats ? JSON.stringify(this.data.stats) : '';
    const update = (): void => {
      if (!current()) return;
      commit();
      this.drilldownKind = '';
      this.drilldownValue = '';
      this.calendarDetailsOpen = false;
      this.calendarPopoverDate = '';
    };
    const key = JSON.stringify(stats);
    if (!previousKey || previousKey === key) {
      update();
      this.resultChanges.reset(key);
    } else this.resultChanges.update(key, (isCurrent: () => boolean) => {
      this.resultSurface.replace(this.getUIContext(), 'stats_result_surface', () => {
        update();
        this.pageScroller.scrollTo({ xOffset: 0, yOffset: 0 });
        this.scrollOffset = 0;
        this.scrollProgress = 0;
        this.onScrollStateChange(false);
      }, () => isCurrent() && current(), Math.max(0, this.topToolsHeight - this.scrollOffset));
    });
  }

  private async refreshStats(): Promise<void> {
    if (await this.data.refresh()) appFeedback.show('统计数据已刷新', 'success');
  }

  private handlePageScroll(): void {
    this.scrollOffset = Math.max(0, this.pageScroller.currentOffset().yOffset);
    this.onScrollStateChange(this.topToolsHeight > 0 && this.scrollOffset >= this.topToolsHeight - 0.5);
    const contentHeight = this.pageScroller.getItemRect(0).height;
    const scrollableHeight = Math.max(1, contentHeight - this.viewportHeight);
    this.scrollProgress = Math.min(1, Math.max(0, this.scrollOffset / scrollableHeight));
  }

  private scrollToTop(): void {
    this.pageScroller.scrollTo({
      xOffset: 0,
      yOffset: 0,
      animation: { duration: 220, curve: Curve.EaseOut }
    });
  }

  private calendarCells(): number[] {
    if (!this.data.selectedMonth) return [];
    const parts = this.data.selectedMonth.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const total = new Date(year, month, 0).getDate();
    const cells: number[] = [];
    for (let index = 0; index < leading; index += 1) cells.push(0);
    for (let day = 1; day <= total; day += 1) cells.push(day);
    return cells;
  }

  private topicCount(day: number): number {
    if (!this.data.stats || day === 0) return 0;
    const suffix = `-${day.toString().padStart(2, '0')}`;
    const activity = this.data.stats.stats.days.find((item) => item.date.endsWith(suffix));
    return activity ? activity.topicCount : 0;
  }

  private monthOptions(): string[] {
    return this.data.months.map((month: MonthSummary) => `${month.label} · ${month.dayCount} 天`);
  }

  private selectedMonthIndex(): number {
    const index = this.data.months.findIndex((month: MonthSummary) => month.id === (this.data.pendingMonth || this.data.selectedMonth));
    return index < 0 ? 0 : index;
  }

  private selectedMonthValue(): string {
    const month = this.data.months.find((item: MonthSummary) => item.id === (this.data.pendingMonth || this.data.refreshMonth()));
    return month ? `${month.label} · ${month.dayCount} 天` :
      (this.data.loading ? '正在读取月份' : (this.data.errorMessage ? '月份读取失败' : '暂无月份'));
  }

  private activeDomainCount(): number {
    return this.data.stats ? this.data.stats.stats.domainCounts.filter((domain: DomainCount) => domain.domain !== '其他').length : 0;
  }

  private deltaDescription(delta: number, suffix: string = ''): string {
    if (delta === 0) return '与上月持平';
    return `${delta > 0 ? '+' : ''}${delta}${suffix}`;
  }

  private deltaColor(delta: number | null): Resource {
    if (delta === null || delta === 0) return $r('app.color.muted_soft');
    return delta > 0 ? $r('app.color.accent_teal') : $r('app.color.primary_active');
  }

  private metricValue(kind: string): number {
    if (!this.data.stats) return 0;
    if (kind === 'days') return this.data.stats.stats.dayCount;
    if (kind === 'topics') return this.data.stats.stats.topicCount;
    if (kind === 'domains') return this.activeDomainCount();
    return this.data.stats.stats.unclassifiedTags.length;
  }

  private metricDelta(kind: string): number | null {
    if (!this.data.stats || !this.data.stats.stats.comparison || kind === 'unclassified') return null;
    if (kind === 'days') return this.data.stats.stats.dayCount - this.data.stats.stats.comparison.dayCount;
    if (kind === 'topics') return this.data.stats.stats.topicCount - this.data.stats.stats.comparison.topicCount;
    return this.activeDomainCount() - this.data.stats.stats.comparison.activeDomains;
  }

  private metricDescription(kind: string): string {
    if (!this.data.stats) return '';
    const delta = this.metricDelta(kind);
    if (kind === 'unclassified') {
      return this.data.stats.stats.unclassifiedTags.length > 0 ? '建议整理映射' : '分类口径完整';
    }
    if (!this.data.stats.stats.comparison) return kind === 'topics' ? '按三级标题计数' :
      (kind === 'domains' ? '不含“其他”' : '暂无上月数据');
    return this.deltaDescription(delta || 0, kind === 'days' ? ' 天' : (kind === 'topics' ? ' 个' : ''));
  }

  private metricLabel(kind: string): string {
    if (kind === 'days') return '记录天数';
    if (kind === 'topics') return '日志小节';
    if (kind === 'domains') return '活跃领域';
    return '未分类标签';
  }

  private dayDate(day: number): string {
    return `${this.data.selectedMonth}-${day.toString().padStart(2, '0')}`;
  }

  private openDrilldown(kind: string, value: string): void {
    this.drilldownKind = kind;
    this.drilldownValue = value;
    this.calendarDetailsOpen = kind === 'day' && !this.isLargeWorkspace();
    this.calendarPopoverDate = kind === 'day' && this.isLargeWorkspace() ? value : '';
  }

  private closeCalendarDetails(): void {
    this.calendarDetailsOpen = false;
    this.calendarPopoverDate = '';
  }

  private calendarLayoutChanged(): void {
    if ((this.calendarDetailsOpen && this.isLargeWorkspace()) ||
      (this.calendarPopoverDate.length > 0 && !this.isLargeWorkspace())) {
      this.closeCalendarDetails();
    }
  }

  private calendarPanelHeight(): number {
    if (this.isLargeWorkspace()) {
      return 104 + Math.min(4, this.drilldownEntries().length) * 66;
    }
    return Math.min(500, 126 + Math.max(1, this.drilldownEntries().length) * 66);
  }

  @Builder
  private calendarDetailsPopover() {
      Column() {
        this.calendarDetailsPanel()
      }
      .width('100%')
      .focusable(true).defaultFocus(true)
    .onKeyEvent((event: KeyEvent) => {
      if (event.type === KeyType.Down && event.keyCode === KeyCode.KEYCODE_ESCAPE) {
        this.closeCalendarDetails();
        event.stopPropagation();
      }
    })
  }

  private drilldownEntries(): StatsEntry[] {
    if (!this.data.stats) return [];
    const entries = this.data.stats.stats.entries || [];
    if (this.drilldownKind === 'day') return entries.filter((item: StatsEntry) => item.date === this.drilldownValue);
    if (this.drilldownKind === 'domain') return entries.filter((item: StatsEntry) => item.domain === this.drilldownValue);
    if (this.drilldownKind === 'tag') return entries.filter((item: StatsEntry) => item.tag === this.drilldownValue);
    return [];
  }

  private domainColor(index: number): Resource {
    if (index % 3 === 1) return $r('app.color.accent_teal');
    if (index % 3 === 2) return $r('app.color.accent_amber');
    return $r('app.color.primary');
  }

  @Builder
  private calendarCell(day: number) {
    if (day === 0) {
      Row().height(40)
    } else {
      Row({ space: 2 }) {
        Text(day.toString())
          .fontSize(12)
          .fontColor(this.topicCount(day) > 0 ? $r('app.color.ink') : $r('app.color.muted_soft'))
        if (this.topicCount(day) > 0) {
          Text(this.topicCount(day).toString())
            .fontSize(8)
            .fontColor($r('app.color.primary_active'))
            .translate({ y: -3 })
        }
      }
      .height(40)
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .alignItems(VerticalAlign.Center)
      .backgroundColor(this.drilldownKind === 'day' && this.drilldownValue === this.dayDate(day) ?
        $r('app.color.primary_tint_strong') : (this.topicCount(day) > 2 ? $r('app.color.primary_tint_strong') :
          (this.topicCount(day) > 0 ? $r('app.color.primary_tint') : Color.Transparent)))
      .border({
        width: 1,
        color: this.drilldownKind === 'day' && this.drilldownValue === this.dayDate(day) ?
          $r('app.color.primary_active') :
          (this.topicCount(day) > 0 ? $r('app.color.primary') : $r('app.color.hairline_soft'))
      })
      .borderRadius(6).clip(true)
      .onClick(() => {
        if (this.topicCount(day) > 0) this.openDrilldown('day', this.dayDate(day));
      })
      .bindPopup(this.calendarPopoverDate === this.dayDate(day) && this.isLargeWorkspace(), {
        builder: this.calendarDetailsPopover(),
        placement: Placement.Bottom,
        width: 400,
        mask: false,
        enableArrow: true,
        autoCancel: true,
        targetSpace: 6,
        popupColor: $r('app.color.canvas'),
        radius: 8,
        backgroundBlurStyle: BlurStyle.NONE,
        shadow: { radius: 12, color: $r('app.color.popover_shadow'), offsetY: 4 },
        onStateChange: (event) => {
          if (!event.isVisible && this.calendarPopoverDate === this.dayDate(day)) {
            this.calendarPopoverDate = '';
            this.drilldownKind = '';
            this.drilldownValue = '';
          }
        }
      })
    }
  }

  @Builder
  private metric(kind: string, endDivider: boolean) {
    Row({ space: 8 }) {
      Column({ space: 3 }) {
        Text(this.metricLabel(kind)).fontSize(12).fontWeight(600).fontColor($r('app.color.muted'))
        Row({ space: 3 }) {
          if (this.metricDelta(kind) !== null && this.metricDelta(kind) !== 0) {
            Image(this.metricDelta(kind)! > 0 ? $r('app.media.trending_up') : $r('app.media.trending_down'))
              .width(12).height(12).objectFit(ImageFit.Contain)
          }
          Text(this.metricDescription(kind)).fontSize(11).fontColor(this.deltaColor(this.metricDelta(kind))).maxLines(1)
        }
        .height(15)
        .alignItems(VerticalAlign.Center)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text(this.metricValue(kind).toString())
        .fontFamily(workspaceLatinSerifFamily(this.workspaceBreakpoint))
        .fontSize(30)
        .fontColor($r('app.color.ink'))
    }
    .layoutWeight(1)
    .height(78)
    .alignItems(VerticalAlign.Center)
    .padding({ left: 16, right: 14 })
    .border({ width: { right: endDivider ? 1 : 0 }, color: $r('app.color.hairline_soft') })
  }

  @Builder
  private domainRow(domain: DomainCount, index: number) {
    Column({ space: 7 }) {
      Row() {
        Text(domain.domain).fontSize(14).fontColor($r('app.color.body')).layoutWeight(1)
        Text(`${domain.percentage.toFixed(1)}%`).fontSize(13).fontColor($r('app.color.muted'))
      }.width('100%')
      Stack({ alignContent: Alignment.Start }) {
        Row().width('100%').height(6).backgroundColor($r('app.color.surface_card')).borderRadius(3)
        Row().width(`${Math.max(2, domain.percentage)}%`).height(6)
          .backgroundColor(this.domainColor(index)).borderRadius(3)
      }.width('100%').height(6)
    }.width('100%').onClick(() => this.openDrilldown('domain', domain.domain))
  }

  @Builder
  private drilldownList() {
    Column({ space: 8 }) {
      Row() {
        Column({ space: 2 }) {
          Text(this.drilldownValue).fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
          Text(`${this.drilldownEntries().length} 个日志小节，点击查看原文。`)
            .fontSize(11).fontColor($r('app.color.muted'))
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        Button({ type: ButtonType.Normal }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(15).fontColor([$r('app.color.muted')])
        }
        .width(32).height(32).padding(0).borderRadius(6).clip(true).backgroundColor(Color.Transparent)
        .onClick(() => { this.drilldownKind = ''; this.drilldownValue = ''; })
      }.width('100%')
      ForEach(this.drilldownEntries(), (entry: StatsEntry) => {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            Text(entry.date).fontSize(11).fontColor($r('app.color.muted')).width(70)
            Column({ space: 2 }) {
              Text(entry.headingText).fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
                .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(entry.domain).fontSize(10).fontColor($r('app.color.muted'))
            }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          }.width('100%')
        }
        .width('100%').height(58).padding({ left: 10, right: 10 })
        .backgroundColor($r('app.color.canvas')).fontColor($r('app.color.ink'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .onClick(() => this.onOpenEntry(entry))
      }, (entry: StatsEntry) => `${entry.date}-${entry.headingIndex}-${entry.rawHeading}`)
    }
    .width('100%').padding(14).alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface_soft'))
    .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
  }

  @Builder
  private calendarDetailsPanel() {
    Column() {
      ActionPanelHeader({
        title: this.drilldownValue,
        showDragBar: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT,
        closeLabel: '关闭日期明细',
        onClose: () => this.closeCalendarDetails()
      })
        .margin({ bottom: 8 })
      Row() {
        Text(`${this.drilldownEntries().length} 个日志小节`)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor($r('app.color.body'))
          .layoutWeight(1)
        if (!this.isLargeWorkspace()) {
          Text('点击查看原文')
          .fontSize(11)
          .fontColor($r('app.color.muted'))
        }
      }
      .width('100%')
      .margin({ bottom: 10 })
      List({ space: 8 }) {
        ForEach(this.drilldownEntries(), (entry: StatsEntry) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Column({ space: 3 }) {
                  Text(entry.headingText)
                    .fontSize(14)
                    .fontWeight(FontWeight.Medium)
                    .fontColor($r('app.color.body_strong'))
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(entry.domain)
                    .fontSize(11)
                    .fontColor($r('app.color.muted'))
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                SymbolGlyph($r('sys.symbol.chevron_forward'))
                  .fontSize(14)
                  .fontColor([$r('app.color.muted_soft')])
              }
              .width('100%')
            }
            .width('100%')
            .height(58)
            .padding({ left: 12, right: 12 })
            .backgroundColor($r('app.color.canvas'))
            .border({ width: 1, color: $r('app.color.hairline') })
            .borderRadius(8)
            .clip(true)
            .onClick(() => {
              this.closeCalendarDetails();
              this.onOpenEntry(entry);
            })
          }
        }, (entry: StatsEntry) => `${entry.date}-${entry.headingIndex}-${entry.rawHeading}`)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Auto)
    }
    .width('100%')
    .height(this.calendarPanelHeight())
    .padding(this.isLargeWorkspace() ? { left: 12, right: 12, top: 8, bottom: 12 } :
      { left: 16, right: 16, top: 8, bottom: 18 })
    .alignItems(HorizontalAlign.Center)
    .backgroundColor($r('app.color.canvas'))
  }

  @Builder
  private pageBody() {
    Stack({ alignContent: Alignment.BottomEnd }) {
    Row() {
    Scroll(this.pageScroller) {
      Column() {
        Flex({ direction: this.isLargeWorkspace() ? FlexDirection.Row : FlexDirection.Column,
          alignItems: ItemAlign.Center, justifyContent: FlexAlign.SpaceBetween }) {
        Row() {
          AppDropdown({
            options: this.monthOptions(),
            selectedIndex: this.selectedMonthIndex(),
            value: this.selectedMonthValue(),
            icon: $r('app.media.calendar_days'),
            accessibilityLabel: '选择统计月份',
            onSelect: (index: number) => {
              if (index >= 0 && index < this.data.months.length) this.loadStats(this.data.months[index].id);
            }
          }).width('100%').height(38).enabled(this.data.months.length > 0)
        }.width(this.isLargeWorkspace() ? 280 : '100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })

        Row({ space: 8 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              if (this.data.loading) LoadingProgress().width(15).height(15).color($r('app.color.ink'))
              else Image($r('app.media.refresh_cw')).width(15).height(15).objectFit(ImageFit.Contain)
              Text(this.data.loading ? '刷新中' : '刷新').fontSize(14).fontWeight(FontWeight.Medium)
            }
          }.layoutWeight(1).height(38).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
          .enabled(!this.data.loading).onClick(() => this.refreshStats())
          .id('stats_refresh')
          if (!this.isLargeWorkspace() && this.showTaxonomyManager) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 6 }) {
              Image($r('app.media.settings_2')).width(15).height(15).objectFit(ImageFit.Contain)
              Text('分类管理').fontSize(14).fontWeight(FontWeight.Medium)
            }
          }.layoutWeight(1).height(38).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
          .onClick(() => this.onOpenTaxonomyManager())
          }
        }.width(this.isLargeWorkspace() ? 112 : '100%')
          .padding({ left: 16, right: 16, bottom: this.isLargeWorkspace() ? 8 : 12, top: this.isLargeWorkspace() ? 8 : 0 })
        }
        .width('100%')
        .border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
        .onAreaChange((_oldValue, newValue) => {
          this.topToolsHeight = Number(newValue.height);
          this.onScrollStateChange(this.scrollOffset >= this.topToolsHeight - 0.5);
        })

        InlineStatus({ text: this.data.stats ? this.data.errorMessage : '', error: true,
          retry: !this.data.loading, onRetry: () => this.refreshStats() })
        if (this.data.loading && !this.data.stats) {
          ContentLoadingState({ text: '正在加载统计…' })
            .height(Math.max(180, this.viewportHeight - this.topToolsHeight))
        } else if (this.data.stats) {
          Column({ space: 22 }) {
            Column() {
              if (this.viewportWidth >= 840) {
                Row() {
                  this.metric('days', true)
                  this.metric('topics', true)
                  this.metric('domains', true)
                  this.metric('unclassified', false)
                }.width('100%')
              } else {
              Row() {
                this.metric('days', true)
                this.metric('topics', false)
              }.width('100%').border({ width: { bottom: 1 }, color: $r('app.color.hairline') })
              Row() {
                this.metric('domains', true)
                this.metric('unclassified', false)
              }.width('100%')
              }
            }
            .width('100%').border({ width: { top: 1, bottom: 1 }, color: $r('app.color.hairline') })

            Column({ space: 10 }) {
              Row() {
                Column({ space: 2 }) {
                  Text('学习日历').fontFamily(workspaceSansFamily(this.workspaceBreakpoint)).fontSize(17)
                    .fontWeight(FontWeight.Medium).fontColor($r('app.color.body_strong'))
                  Text('颜色深浅表示当日日志小节数量').fontSize(11).fontColor($r('app.color.muted'))
                }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                Text(`含小节 ${this.data.stats!.stats.technicalDayCount} 天`).fontSize(11).fontColor($r('app.color.muted')).maxLines(2)
              }.width('100%')
              Grid() {
                ForEach(['一', '二', '三', '四', '五', '六', '日'], (label: string) => {
                  GridItem() { Text(label).fontSize(10).fontColor($r('app.color.muted')).textAlign(TextAlign.Center) }
                })
              }.columnsTemplate('repeat(7, 1fr)').rowsGap(4).height(20)
              Grid() {
                ForEach(this.calendarCells(), (day: number, index: number) => {
                  GridItem() { this.calendarCell(day) }
                }, (day: number, index: number) => `${index}-${day}`)
              }.columnsTemplate('repeat(7, 1fr)').columnsGap(4).rowsGap(4).width('100%')
            }
            .width('100%').padding(14).alignItems(HorizontalAlign.Start)
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
            Column({ space: 14 }) {
              SectionHeading({ title: '领域占比', description: '按日志小节数量计算，而非按正文长度计算' })
              ForEach(this.data.stats!.stats.domainCounts, (domain: DomainCount, index: number) => {
                this.domainRow(domain, index)
              }, (domain: DomainCount) => domain.domain)
            }
            .width('100%').padding(14).alignItems(HorizontalAlign.Start)
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
            if (this.drilldownKind === 'domain') {
              this.drilldownList()
            }

            Column({ space: 12 }) {
              SectionHeading({ title: '高频标签', description: '本月重复出现较多的三级标题标签' })
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.data.stats!.stats.topTags, (tag: TagCount) => {
                  Row({ space: 6 }) {
                    Text(tag.tag).fontSize(13).fontColor($r('app.color.body'))
                    Text(tag.count.toString()).fontSize(12).fontColor($r('app.color.muted'))
                  }.padding({ left: 10, right: 10, top: 6, bottom: 6 })
                  .margin({ right: 8, bottom: 8 })
                  .backgroundColor($r('app.color.surface_card')).borderRadius(15)
                  .onClick(() => this.openDrilldown('tag', tag.tag))
                }, (tag: TagCount) => tag.tag)
              }.width('100%')
            }
            .width('100%').padding(14).alignItems(HorizontalAlign.Start)
            .backgroundColor($r('app.color.surface_soft'))
            .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(10)
            if (this.drilldownKind === 'tag') {
              this.drilldownList()
            }
          }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 40 })
        } else if (this.data.errorMessage) {
          Column() {
            LoadFailure({ title: '统计读取失败', message: this.data.errorMessage, onRetry: () => this.refreshStats() })
          }.width('100%').height(360)
        } else {
          Column() {
            EmptyState({ symbol: $r('sys.symbol.histogram'), title: '暂无统计', description: '当前月份没有可统计的日志小节' })
          }.width('100%').height(360)
        }
      }.width('100%')
    }.width('100%').constraintSize({ maxWidth: COLLECTION_MAX_WIDTH }).height('100%').align(Alignment.TopStart)
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring, { alwaysEnabled: true })
    .backgroundColor($r('app.color.canvas'))
    .onAreaChange((_oldValue, newValue) => {
      this.viewportHeight = Number(newValue.height);
      this.viewportWidth = Number(newValue.width);
    })
    .onScroll(() => this.handlePageScroll())
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
    ResultSurfaceCover({ controller: this.resultSurface })
    Row() {
      if (this.data.loading && this.data.stats !== null) {
        LoadingHintAnchor({ loading: true, onChange: this.onLoadingHintChange })
      }
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).hitTestBehavior(HitTestMode.None)
    BackToTopControl({
      visible: this.scrollOffset > 8,
      progress: this.scrollProgress,
      scrollOffset: this.scrollOffset,
      onBackToTop: () => this.scrollToTop()
    })
      .margin({ right: this.isLargeWorkspace() ? 24 : 14, bottom: this.isLargeWorkspace() ? 24 : 14 })
      .zIndex(1)
    }.width('100%').height('100%').id('stats_result_surface')
    .bindSheet($$this.calendarDetailsOpen, this.calendarDetailsPanel(), {
      preferType: !this.desktopWindowChrome && this.workspaceBreakpoint === WorkspaceBreakpoint.COMPACT ? SheetType.BOTTOM : SheetType.CENTER,
      height: SheetSize.FIT_CONTENT,
      dragBar: false,
      showClose: false,
      maskColor: $r('app.color.scrim'),
      radius: LengthMetrics.vp(12),
      onDisappear: () => {
        if (!this.calendarDetailsOpen) {
          this.drilldownKind = '';
          this.drilldownValue = '';
        }
      }
    })
  }

  build() {
    Column() {
      if (this.isLargeWorkspace()) {
        ModulePageHeader({ title: '学习统计',
          headerId: 'desktop_page_stats', onOpenLog: this.onOpenLog })
      }
      Row() {
        this.pageBody()
      }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
    }.width('100%').height('100%')
  }
}

import { LogNavigation } from '../../features/logs/components/LogNavigation';
import { LogNavigationController } from '../../features/logs/LogNavigationController';
import { DaySummary } from '../../features/logs/LogModels';
import { WORKSPACE_TIPS } from '../../common/ui/WorkspaceTips';
import { expandSection } from '../../common/ui/WorkspaceMotion';

@Component
export struct WorkspaceLogNavigation {
  @ObjectLink logNavigation: LogNavigationController;
  @Prop selectedDate: string = '';
  @Prop wide: boolean = false;
  @Link navigationMonthsExpanded: boolean;
  @Link navigationDayQuery: string;
  @Link newLogDate: string;
  @Link calendarMode: string;
  @Link calendarOpen: boolean;
  logNavigationScroller: Scroller = new Scroller();
  onOpenCalendar: (mode: string) => void = () => {};
  onCollapse: () => void = () => {};
  onMonth: (month: string) => void = () => {};
  onDay: (date: string) => void = () => {};
  onHeading: (day: DaySummary, heading: string, index: number) => void = () => {};
  onOpenDate: (date: string) => void = () => {};
  onNewLog: (date: string) => void = () => {};
  onRetry: () => void = () => {};

  private openNewLog(date: string): void {
    this.calendarOpen = false;
    this.onNewLog(date);
  }

  private calendarDate(value: Date): string {
    return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, '0')}-${value.getDate().toString().padStart(2, '0')}`;
  }

  private async loadCalendar(): Promise<void> {
    await this.logNavigation.loadCalendar();
  }

  private shiftCalendar(offset: number): void {
    const parts = this.logNavigation.calendarMonth.split('-');
    this.logNavigation.calendarMonth = this.calendarDate(new Date(Number(parts[0]), Number(parts[1]) - 1 + offset, 1)).slice(0, 7);
    this.loadCalendar();
  }

  private calendarCells(): string[] {
    if (!this.logNavigation.calendarMonth) return [];
    const parts = this.logNavigation.calendarMonth.split('-');
    const first = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    const count = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    const cells: string[] = [];
    for (let index = 0; index < (first.getDay() + 6) % 7; index++) cells.push('');
    for (let day = 1; day <= count; day++) cells.push(`${this.logNavigation.calendarMonth}-${day.toString().padStart(2, '0')}`);
    return cells;
  }

  private canSelectCalendarDate(date: string): boolean {
    return !!date && date <= this.calendarDate(new Date()) &&
      (this.calendarMode === 'create' || (!this.logNavigation.calendarLoading && !this.logNavigation.calendarError && this.logNavigation.calendarDates.includes(date)));
  }

  private selectCalendarDate(date: string): void {
    if (!this.canSelectCalendarDate(date)) return;
    this.calendarOpen = false;
    if (this.calendarMode === 'jump') this.onOpenDate(date);
    else this.newLogDate = date;
  }

  @Builder
  private logCalendar() {
    Column({ space: 8 }) {
      Text(this.calendarMode === 'jump' ? '跳转到日期' : '选择新建日期')
        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
      Row() {
        Button('‹', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .accessibilityText('上一个月').onClick(() => this.shiftCalendar(-1))
        Text(this.logNavigation.calendarMonth).fontSize(14).fontColor($r('app.color.ink')).layoutWeight(1).textAlign(TextAlign.Center)
        Button('›', { type: ButtonType.Normal }).width(36).height(36)
          .fontSize(20).fontColor($r('app.color.body')).backgroundColor(Color.Transparent)
          .enabled(this.logNavigation.calendarMonth < this.calendarDate(new Date()).slice(0, 7))
          .accessibilityText('下一个月').onClick(() => this.shiftCalendar(1))
      }.width('100%')
      Row() {
        ForEach(['一', '二', '三', '四', '五', '六', '日'], (day: string) => {
          Text(day).width('14.2857%').textAlign(TextAlign.Center).fontSize(12).fontColor($r('app.color.muted'))
        })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.calendarCells(), (date: string, index: number) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 2 }) {
              Text(date ? Number(date.slice(-2)).toString() : '').fontSize(13)
                .fontColor(this.canSelectCalendarDate(date) ? $r('app.color.ink') : $r('app.color.muted_soft'))
              Circle().width(3).height(3).fill(this.logNavigation.calendarDates.includes(date) ? $r('app.color.primary') : Color.Transparent)
            }
          }
          .id(`log_calendar_day_${date || index}`).width('14.2857%').height(36).padding(0)
          .backgroundColor(date && date === (this.calendarMode === 'jump' ? this.selectedDate : this.newLogDate) ?
            $r('app.color.surface_card') : Color.Transparent)
          .borderRadius(6).enabled(this.canSelectCalendarDate(date))
          .accessibilityText(date).onClick(() => this.selectCalendarDate(date))
        }, (date: string, index: number) => `${date}:${index}`)
      }.width('100%')
      if (this.logNavigation.calendarError) {
        Button('读取失败，点击重试', { type: ButtonType.Normal }).fontSize(12)
          .fontColor($r('app.color.muted')).backgroundColor(Color.Transparent).onClick(() => this.loadCalendar())
      } else {
        Text(this.logNavigation.calendarLoading ? '正在读取日志日期…' :
          this.calendarMode === 'jump' ? '有记录的日期可直接跳转' : '选定日期后，点击“新建”打开日块')
          .fontSize(12).fontColor($r('app.color.muted'))
      }
    }.width(280).padding(14)
  }

  @Builder
  private dateActions() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 7 }) {
          SymbolGlyph($r('sys.symbol.plus')).fontSize(15).fontColor([$r('app.color.ink')])
          Text('今天').fontSize(13).fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
        }.justifyContent(FlexAlign.Center)
      }
      .width('100%').height(40).padding(0).margin({ bottom: 8 })
      .backgroundColor($r('app.color.canvas'))
      .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
      .onClick(() => this.openNewLog(this.calendarDate(new Date())))
      Row({ space: 8 }) {
        Button({ type: ButtonType.Normal }) {
          Row({ space: 7 }) {
            SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.ink')])
            Text(this.newLogDate || this.calendarDate(new Date())).fontSize(13)
              .fontWeight(FontWeight.Medium).fontColor($r('app.color.ink'))
          }.justifyContent(FlexAlign.Center)
        }
        .layoutWeight(1).height(40).padding(0).backgroundColor($r('app.color.canvas'))
        .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8).clip(true)
        .id('log_create_date_picker').accessibilityText('选择新建日期')
        .onClick(() => this.onOpenCalendar('create'))
        .bindPopup(this.calendarOpen && this.calendarMode === 'create', {
          builder: this.logCalendar(), placement: Placement.Bottom, enableArrow: false,
          popupColor: $r('app.color.canvas'), radius: 8,
          onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'create') this.calendarOpen = false; }
        })
        Button('+ 新建', { type: ButtonType.Normal }).height(40).padding({ left: 10, right: 10 })
          .fontSize(13).fontColor($r('app.color.ink')).backgroundColor($r('app.color.canvas'))
          .border({ width: 1, color: $r('app.color.hairline') }).borderRadius(8)
          .id('log_create_date_submit').onClick(() => this.openNewLog(this.newLogDate || this.calendarDate(new Date())))
      }.width('100%')
    }.width('100%')
  }

  @Builder
  private jumpDatePicker() {
    Button({ type: ButtonType.Normal }) {
      SymbolGlyph($r('sys.symbol.calendar')).fontSize(15).fontColor([$r('app.color.primary_active')])
    }.width(28).height(28).padding(0).backgroundColor(Color.Transparent)
      .id('log_jump_date_picker').accessibilityText('跳转到指定日期')
      .onClick(() => this.onOpenCalendar('jump'))
      .bindPopup(this.calendarOpen && this.calendarMode === 'jump', {
        builder: this.logCalendar(), placement: Placement.BottomRight, enableArrow: false,
        popupColor: $r('app.color.canvas'), radius: 8,
        onStateChange: (event) => { if (!event.isVisible && this.calendarMode === 'jump') this.calendarOpen = false; }
      })
  }

  build() {
    Column() {
      if (this.wide) {
        Row({ space: 6 }) {
          Image($r('app.media.tab_file_text_active')).width(19).height(19).objectFit(ImageFit.Contain)
          Text('学习日志').fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.body_strong')).layoutWeight(1)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Button({ type: ButtonType.Normal }) {
            SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(16).fontColor([$r('app.color.body')])
          }.width(34).height(34).padding(0).backgroundColor(Color.Transparent).borderRadius(8)
            .id('sidebar_collapse').accessibilityText('折叠侧栏').bindTips('折叠侧栏', WORKSPACE_TIPS)
            .onClick(() => this.onCollapse())
        }.width('100%').height(52).padding({ left: 16, right: 10 })
          .border({ width: { bottom: 1 }, color: $r('app.color.hairline_soft') })
      }
      LogNavigation({ navigationMonths: this.logNavigation.months, navigationDays: this.logNavigation.days,
        navigationMonth: this.logNavigation.month, requestedDate: this.selectedDate,
        logNavigationScroller: this.logNavigationScroller,
        navigationMonthsExpanded: this.navigationMonthsExpanded,
        navigationDayQuery: this.navigationDayQuery,
        navigationLoading: this.logNavigation.monthsLoading || this.logNavigation.daysLoading,
        navigationError: this.logNavigation.navigationError,
        dateActions: (): void => this.dateActions(),
        jumpDatePicker: (): void => this.jumpDatePicker(),
        onMonth: (month: string) => this.onMonth(month),
        onDay: (date: string) => this.onDay(date),
        onHeading: (day: DaySummary, heading: string, index: number) => this.onHeading(day, heading, index),
        onQuery: (query: string) => this.navigationDayQuery = query,
        onToggleMonths: () => expandSection(this.getUIContext(), () => {
          this.navigationMonthsExpanded = !this.navigationMonthsExpanded;
        }),
        onRetry: () => this.onRetry() })
    }
    .width('100%').height('100%')
    .backgroundColor(this.wide ? $r('app.color.surface_soft') : $r('app.color.canvas'))
  }

}

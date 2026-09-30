import { MonthSummary, DaySummary } from './LogModels';
import { LogReadRepository } from './LogReadRepository';

export interface LogNavigationView {
  lifecycle: () => number;
  restoreDate: () => string;
  beforeRead: () => void;
  readingStarted: (months: boolean) => void;
  beforeChange: () => Promise<void>;
  openDay: (date: string) => Promise<void>;
  documentFailed: () => boolean;
  clearDocument: () => void;
  emptyDayList: () => void;
  finishTransition: () => void;
  message: (error: Error) => string;
  setRetry: (retry: () => Promise<void>) => void;
  failed: (message: string, retry: () => Promise<void>) => void;
}

// Original navigation-controller responsibility with public cross-month rollback and retry semantics.
@Observed
export class LogNavigationController {
  months: MonthSummary[] = [];
  days: DaySummary[] = [];
  month: string = '';
  monthsLoading: boolean = true;
  daysLoading: boolean = false;
  navigationError: string = '';
  calendarMonth: string = '';
  calendarDates: string[] = [];
  calendarLoading: boolean = false;
  calendarError: boolean = false;
  private listRevision: number = 0;
  private monthsRevision: number = 0;
  private calendarRevision: number = 0;
  private reads?: LogReadRepository;
  private view?: LogNavigationView;

  bind(reads: LogReadRepository, view: LogNavigationView): void { this.reads = reads; this.view = view; }
  dispose(): void {
    this.view = undefined; this.reads = undefined;
    this.monthsRevision++; this.listRevision++; this.calendarRevision++;
    this.monthsLoading = false; this.daysLoading = false; this.calendarLoading = false;
  }

  async loadMonths(): Promise<void> {
    const view = this.view;
    const reads = this.reads;
    if (!view || !reads) return;
    const lifecycle = view.lifecycle();
    const revision = ++this.monthsRevision;
    view.beforeRead();
    this.monthsLoading = true;
    view.readingStarted(true);
    try {
      const response = await reads.months();
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.monthsRevision) return;
      if (!Array.isArray(response.months)) throw new Error('月份响应格式异常');
      this.months = response.months;
      const restoreDate = view.restoreDate();
      if (restoreDate || response.months.length > 0) {
        await this.loadDays(restoreDate ? restoreDate.slice(0, 7) : response.months[0].id, restoreDate);
      } else { this.month = ''; this.days = []; view.clearDocument(); }
    } catch (error) {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.monthsRevision) {
        view.failed(view.message(error as Error), async () => this.loadMonths());
      }
    } finally {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.monthsRevision) this.monthsLoading = false;
    }
  }

  async loadDays(month: string, targetDate: string = ''): Promise<void> {
    const view = this.view;
    const reads = this.reads;
    if (!view || !reads) return;
    const lifecycle = view.lifecycle();
    view.beforeRead();
    this.monthsRevision++;
    const revision = ++this.listRevision;
    await view.beforeChange();
    if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.listRevision) return;
    const previousMonth = this.month;
    const previousDays = this.days;
    this.month = month;
    this.monthsLoading = false;
    this.daysLoading = true;
    view.readingStarted(false);
    this.navigationError = '';
    try {
      const response = await reads.days(month);
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.listRevision) return;
      if (!Array.isArray(response.days)) throw new Error('日期响应格式异常');
      this.days = response.days;
      if (targetDate) await view.openDay(targetDate);
      else if (response.days.length > 0) await view.openDay(response.days[0].date);
      else { view.clearDocument(); view.emptyDayList(); }
      if (this.view !== view || lifecycle !== view.lifecycle() || revision !== this.listRevision) return;
      if (view.documentFailed()) {
        this.month = previousMonth;
        this.days = previousDays;
        view.setRetry(async () => this.loadDays(month, targetDate));
      }
    } catch (error) {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.listRevision) {
        this.month = previousMonth;
        this.navigationError = view.message(error as Error);
        view.failed(this.navigationError, async () => this.loadDays(month, targetDate));
        view.finishTransition();
      }
    } finally {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.listRevision) this.daysLoading = false;
    }
  }

  async loadCalendar(): Promise<void> {
    const view = this.view;
    const reads = this.reads;
    if (!view || !reads) return;
    const revision = ++this.calendarRevision;
    const lifecycle = view.lifecycle();
    this.calendarLoading = true;
    this.calendarError = false;
    this.calendarDates = [];
    try {
      const response = await reads.days(this.calendarMonth);
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.calendarRevision) {
        this.calendarDates = response.days.map((day: DaySummary) => day.date);
      }
    } catch (_) {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.calendarRevision) this.calendarError = true;
    } finally {
      if (this.view === view && lifecycle === view.lifecycle() && revision === this.calendarRevision) this.calendarLoading = false;
    }
  }
}

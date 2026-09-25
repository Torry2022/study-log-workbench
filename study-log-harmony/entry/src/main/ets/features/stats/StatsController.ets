import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { MonthSummary, MonthsResponse } from '../logs/LogModels';
import { StatsResponse } from './StatsModels';

export interface StatsView {
  requestedMonth: () => string;
  monthsChanged: (months: MonthSummary[]) => void;
  monthsLoading: (loading: boolean) => void;
  monthsError: (message: string) => void;
  selectedMonthChanged: (month: string) => void;
  prepareResult: () => void;
  publishResult: (stats: StatsResponse, commit: () => void, current: () => boolean) => void;
}

@Observed
export class StatsController {
  months: MonthSummary[] = [];
  selectedMonth: string = '';
  pendingMonth: string = '';
  stats: StatsResponse | null = null;
  loading: boolean = true;
  errorMessage: string = '';
  private retryMonth: string = '';
  private statsRevision: number = 0;
  private monthsRevision: number = 0;
  private transport: ApiClient;
  private view: StatsView;

  constructor(transport: ApiClient, view: StatsView) {
    this.transport = transport;
    this.view = view;
  }

  dispose(): void {
    this.monthsRevision += 1;
    this.statsRevision += 1;
  }

  async loadMonths(): Promise<boolean> {
    const revision = ++this.monthsRevision;
    const statsRevision = this.statsRevision;
    this.loading = true;
    this.errorMessage = '';
    this.view.monthsError('');
    this.view.monthsLoading(true);
    try {
      const response = await this.transport.get<MonthsResponse>('/logs/months');
      if (revision !== this.monthsRevision) return false;
      this.months = response.months;
      this.view.monthsChanged(this.months);
      const requested = this.view.requestedMonth();
      const initial = this.months.some((month: MonthSummary) => month.id === requested) ?
        requested : (this.months[0]?.id || '');
      if (initial) return await this.loadStats(initial);
      this.stats = null;
      this.selectedMonth = '';
      this.retryMonth = '';
      this.view.selectedMonthChanged('');
      return true;
    } catch (error) {
      if (revision !== this.monthsRevision) return false;
      this.errorMessage = error instanceof ApiError ? error.message : '统计月份读取失败';
      this.view.monthsError(this.errorMessage);
      return false;
    } finally {
      if (revision === this.monthsRevision) {
        if (statsRevision === this.statsRevision) this.loading = false;
        this.view.monthsLoading(false);
      }
    }
  }

  async loadStats(month: string): Promise<boolean> {
    this.view.prepareResult();
    this.retryMonth = month;
    this.pendingMonth = month;
    this.view.selectedMonthChanged(month);
    const revision = ++this.statsRevision;
    this.loading = true;
    this.errorMessage = '';
    try {
      const stats = await this.transport.get<StatsResponse>(`/stats?month=${encodeURIComponent(month)}`);
      if (revision !== this.statsRevision) return false;
      const current = (): boolean => revision === this.statsRevision;
      this.view.publishResult(stats, () => {
        if (!current()) return;
        this.selectedMonth = month;
        this.pendingMonth = '';
        this.stats = stats;
        this.view.selectedMonthChanged(month);
      }, current);
      return true;
    } catch (error) {
      if (revision !== this.statsRevision) return false;
      this.pendingMonth = '';
      this.errorMessage = error instanceof ApiError ? error.message : '统计读取失败';
      this.view.selectedMonthChanged(this.selectedMonth);
      return false;
    } finally {
      if (revision === this.statsRevision) this.loading = false;
    }
  }

  async refresh(): Promise<boolean> {
    return this.retryMonth ? await this.loadStats(this.retryMonth) : await this.loadMonths();
  }

  refreshMonth(): string { return this.retryMonth || this.selectedMonth; }
}

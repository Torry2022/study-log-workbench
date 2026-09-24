import { ApiClient } from '../../common/network/ApiClient';
import { activeInstance } from '../../common/network/InstanceConfig';
import { DayResponse, DaysResponse, MonthsResponse } from './LogModels';

// Share only pending reads. Selection, drafts and completed responses belong to the page.
export class LogReadRepository {
  private transport: ApiClient;
  private instanceRevision: number = -1;
  private sessionRevision: number = -1;
  private monthsRequest?: Promise<MonthsResponse>;
  private daysRequests: Map<string, Promise<DaysResponse>> = new Map();

  constructor(transport: ApiClient) { this.transport = transport; }

  private currentInstance(): void {
    if (this.instanceRevision === activeInstance.revision &&
      this.sessionRevision === this.transport.getSessionRevision()) return;
    this.invalidate();
    this.instanceRevision = activeInstance.revision;
    this.sessionRevision = this.transport.getSessionRevision();
  }

  months(): Promise<MonthsResponse> {
    this.currentInstance();
    if (this.monthsRequest) return this.monthsRequest;
    const request = this.transport.get<MonthsResponse>('/logs/months');
    this.monthsRequest = request;
    const release = (): void => {
      if (this.monthsRequest === request) this.monthsRequest = undefined;
    };
    request.then(release, release);
    return request;
  }

  days(month: string): Promise<DaysResponse> {
    this.currentInstance();
    const pending = this.daysRequests.get(month);
    if (pending) return pending;
    const request = this.transport.get<DaysResponse>(`/logs?month=${encodeURIComponent(month)}`);
    this.daysRequests.set(month, request);
    const release = (): void => {
      if (this.daysRequests.get(month) === request) this.daysRequests.delete(month);
    };
    request.then(release, release);
    return request;
  }

  day(date: string): Promise<DayResponse> {
    this.currentInstance();
    return this.transport.get<DayResponse>(`/logs/day?date=${encodeURIComponent(date)}`);
  }

  invalidate(): void {
    this.monthsRequest = undefined;
    this.daysRequests.clear();
  }
}

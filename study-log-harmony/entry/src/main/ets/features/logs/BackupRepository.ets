import { ApiClient } from '../../common/network/ApiClient';
import { DayResponse } from './LogModels';
import { BackupOverviewResponse, BackupPreviewResponse, BackupRestoreRequest, BackupRestoreResponse } from './BackupModels';

export class BackupRepository {
  private transport: ApiClient;

  constructor(transport: ApiClient) { this.transport = transport; }

  list(date: string, cursor: string = ''): Promise<BackupOverviewResponse> {
    const query = `date=${encodeURIComponent(date)}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    return this.transport.get<BackupOverviewResponse>(`/backups?${query}`);
  }

  preview(date: string, id: string): Promise<BackupPreviewResponse> {
    return this.transport.get<BackupPreviewResponse>(`/backups/preview?date=${encodeURIComponent(date)}` +
      `&kind=write&id=${encodeURIComponent(id)}`);
  }

  restore(request: BackupRestoreRequest): Promise<BackupRestoreResponse> {
    return this.transport.post<BackupRestoreResponse>('/backups/restore', request);
  }

  day(date: string): Promise<DayResponse> {
    return this.transport.get<DayResponse>(`/logs/day?date=${encodeURIComponent(date)}`);
  }
}

import { ApiClient } from '../../common/network/ApiClient';
import { StatsResponse } from './StatsModels';

export class StatsRepository {
  private transport: ApiClient;
  constructor(transport: ApiClient) { this.transport = transport; }

  month(month: string): Promise<StatsResponse> {
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) {
      return Promise.reject(new Error('统计月份无效'));
    }
    return this.transport.get<StatsResponse>(`/stats?month=${month}`);
  }
}

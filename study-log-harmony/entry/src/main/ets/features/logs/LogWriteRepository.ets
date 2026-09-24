import { ApiClient } from '../../common/network/ApiClient';
import { DayResponse, DeleteDayRequest, SaveDayRequest } from './LogModels';

export class LogWriteRepository {
  private transport: ApiClient;

  constructor(transport: ApiClient) { this.transport = transport; }

  save(request: SaveDayRequest): Promise<DayResponse> {
    return this.transport.put<DayResponse>('/logs/day', request);
  }

  delete(request: DeleteDayRequest): Promise<DayResponse> {
    return this.transport.delete<DayResponse>('/logs/day', request);
  }
}

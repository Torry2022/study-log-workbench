import { ApiClient } from '../../common/network/ApiClient';
import { LogSearchResponse } from './LogSearchPanel';

export class LogSearchRepository {
  private transport: ApiClient;
  constructor(transport: ApiClient) { this.transport = transport; }

  search(query: string, headingsOnly: boolean, ignoreCase: boolean): Promise<LogSearchResponse> {
    return this.transport.get<LogSearchResponse>(
      `/search?q=${encodeURIComponent(query.trim())}&ignoreCase=${ignoreCase}` +
        `&scope=${headingsOnly ? 'heading' : 'all'}`);
  }
}

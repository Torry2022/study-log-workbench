import { rcp } from '@kit.RemoteCommunicationKit';
import { activeInstance } from './InstanceConfig';

interface ApiErrorPayload { error?: string; code?: string; }

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string = '') {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ApiClient {
  private token: string = '';
  private sessionRevision: number = 0;
  private onUnauthorized: () => void = () => {};

  setToken(token: string): void {
    this.token = token;
    this.sessionRevision++;
  }

  getToken(): string { return this.token; }
  getSessionRevision(): number { return this.sessionRevision; }

  setUnauthorizedHandler(handler: () => void): () => void {
    this.onUnauthorized = handler;
    return () => { if (this.onUnauthorized === handler) this.onUnauthorized = () => {}; };
  }

  get<T>(path: string): Promise<T> { return this.request<T>(path, 'GET'); }
  post<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'POST', body); }

  private async request<T>(path: string, method: rcp.HttpMethod, body?: object): Promise<T> {
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const headers: rcp.RequestHeaders = { 'accept': 'application/json', 'content-type': 'application/json' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 60000 } }
    } });

    try {
      const request = new rcp.Request(activeInstance.apiUrl(path), method, headers,
        body ? JSON.stringify(body) : undefined);
      const response = await session.fetch(request);
      if (instanceRevision !== activeInstance.revision || sessionRevision !== this.sessionRevision) {
        throw new Error('会话已切换，请重新操作');
      }
      const raw = response.toString() || '';
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (response.statusCode === 401 && requestToken) this.onUnauthorized();
        let payload: ApiErrorPayload = {};
        try { payload = JSON.parse(raw) as ApiErrorPayload; } catch (_) { payload = {}; }
        throw new ApiError(payload.error || `请求失败（${response.statusCode}）`, response.statusCode, payload.code || '');
      }
      try { return JSON.parse(raw) as T; }
      catch (_) { throw new ApiError('服务器响应格式异常', response.statusCode, 'INVALID_RESPONSE'); }
    } finally {
      session.close();
    }
  }
}

export const apiClient: ApiClient = new ApiClient();

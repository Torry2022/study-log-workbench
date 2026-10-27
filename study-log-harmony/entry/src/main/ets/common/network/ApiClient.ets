import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { rcp } from '@kit.RemoteCommunicationKit';
import { util } from '@kit.ArkTS';
import { activeInstance } from './InstanceConfig';
import { ReadCancellation } from './ReadCancellation';

interface ApiErrorPayload { error?: string; code?: string; }

export interface ApiUploadFile { path: string; name: string; contentType: string; }

class MultipartUploadFile implements rcp.FormFieldFileValue {
  contentOrPath: string;
  remoteFileName: string;
  contentType: string;

  constructor(file: ApiUploadFile) {
    this.contentOrPath = file.path;
    this.remoteFileName = file.name;
    this.contentType = file.contentType;
  }
}

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

export class ApiStreamCancelledError extends Error {
  constructor() { super('请求已取消'); this.name = 'ApiStreamCancelledError'; }
}

export class ApiClient {
  private token: string = '';
  private sessionRevision: number = 0;
  private onUnauthorized: () => void = () => {};
  private streamRevision: number = 0;
  private activeStreamSession?: rcp.Session;
  private activeStreamRequest?: rcp.Request;

  setToken(token: string): void {
    this.cancelStream();
    this.token = token;
    this.sessionRevision++;
  }

  getToken(): string { return this.token; }
  getSessionRevision(): number { return this.sessionRevision; }
  getConnectionBinding(): string { return `${activeInstance.revision}:${this.sessionRevision}`; }

  setUnauthorizedHandler(handler: () => void): () => void {
    this.onUnauthorized = handler;
    return () => { if (this.onUnauthorized === handler) this.onUnauthorized = () => {}; };
  }

  async get<T>(path: string, cancellation?: ReadCancellation): Promise<T> {
    return this.read<T>(path, cancellation);
  }

  private async read<T>(path: string, cancellation?: ReadCancellation, instanceId?: string): Promise<T> {
    const binding = this.getConnectionBinding();
    const started = Date.now();
    const safe = /^\/(logs|notes|favorites|stats|taxonomy|wiki|rag|capabilities|auth|internal-links|backups)(\/|\?|$)/.test(path);
    for (let attempt = 1; ; attempt++) {
      cancellation?.check();
      if (binding !== this.getConnectionBinding()) throw new Error('会话已切换，请重新操作');
      try { return await this.request<T>(path, 'GET', undefined, cancellation, instanceId); }
      catch (error) {
        cancellation?.check();
        if (binding !== this.getConnectionBinding()) throw new Error('会话已切换，请重新操作');
        const status = error instanceof ApiError ? error.statusCode : 0;
        const nativeCode = error instanceof ApiError ? Number(error.code) || 0 : Number((error as BusinessError).code) || 0;
        const transient = [502, 503, 504].includes(status) ||
          [1007900005, 1007900006, 1007900007, 1007900028, 1007900035, 1007900052, 1007900055, 1007900056].includes(nativeCode);
        hilog.error(0x0000, 'StudyLogRead',
          'scope=%{public}s status=%{public}d nativeCode=%{public}d attempt=%{public}d elapsedMs=%{public}d',
          path.split('?')[0].split('/')[1], status, nativeCode, attempt, Date.now() - started);
        if (!safe || !transient || attempt === 2) {
          if (nativeCode === 1007900028) throw new ApiError('读取超时，请重试；已有内容已保留', 0, String(nativeCode));
          throw error as Error;
        }
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cancellation?.release(); resolve(); }, 350);
        cancellation?.bind(() => { clearTimeout(timer); reject(new Error('读取已取消')); });
      });
    }
  }

  post<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'POST', body); }
  put<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'PUT', body); }
  patch<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'PATCH', body); }
  delete<T>(path: string, body?: object): Promise<T> { return this.request<T>(path, 'DELETE', body); }

  getForInstance<T>(path: string, instanceId: string): Promise<T> { return this.read<T>(path, undefined, instanceId); }
  postForInstance<T>(path: string, body: object, instanceId: string): Promise<T> { return this.request<T>(path, 'POST', body, undefined, instanceId); }
  deleteForInstance<T>(path: string, instanceId: string): Promise<T> { return this.request<T>(path, 'DELETE', undefined, undefined, instanceId); }

  cancelStream(): void {
    this.streamRevision++;
    if (!this.activeStreamSession || !this.activeStreamRequest) return;
    try { this.activeStreamSession.cancel(this.activeStreamRequest); }
    catch (_) { /* The request may have completed. */ }
  }

  async postStream(path: string, body: object, onChunk: (chunk: string) => void): Promise<void> {
    const revision = ++this.streamRevision;
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const current = (): boolean => revision === this.streamRevision &&
      instanceRevision === activeInstance.revision && sessionRevision === this.sessionRevision;
    const decoder = util.TextDecoder.create('utf-8');
    const events: rcp.HttpEventsHandler = { onDataReceive: (data: ArrayBuffer): void => {
      if (current()) onChunk(decoder.decodeToString(new Uint8Array(data), { stream: true }));
    } };
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 120000 } },
      tracing: { httpEventsHandler: events }
    } });
    const headers: rcp.RequestHeaders = { accept: 'text/event-stream', 'content-type': 'application/json' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    const request = new rcp.Request(activeInstance.apiUrl(path), 'POST', headers, JSON.stringify(body));
    this.activeStreamSession = session;
    this.activeStreamRequest = request;
    try {
      const response = await session.fetch(request).catch(() => {
        throw new ApiError('无法连接服务器，请检查网络后重试', 0, 'NETWORK_ERROR');
      });
      if (!current()) throw new ApiStreamCancelledError();
      const tail = decoder.decodeToString(new Uint8Array(), { stream: false });
      if (tail) onChunk(tail);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (response.statusCode === 401 && requestToken) this.onUnauthorized();
        throw new ApiError(`请求失败（${response.statusCode}）`, response.statusCode);
      }
    } catch (error) {
      if (!current()) throw new ApiStreamCancelledError();
      throw error instanceof Error ? error : new Error('问答请求失败');
    } finally {
      if (this.activeStreamRequest === request) {
        this.activeStreamSession = undefined;
        this.activeStreamRequest = undefined;
      }
      session.close();
    }
  }

  // Task observation owns its connection; it must never cancel a generation or another reader.
  async getEventStreamForInstance(path: string, instanceId: string, onChunk: (chunk: string) => void,
    cancellation: ReadCancellation): Promise<void> {
    cancellation.check();
    const binding = this.getConnectionBinding(), token = this.token;
    const current = (): boolean => !cancellation.cancelled && binding === this.getConnectionBinding();
    const decoder = util.TextDecoder.create('utf-8');
    let parseFailure: Error | undefined;
    const events: rcp.HttpEventsHandler = { onDataReceive: (data: ArrayBuffer): void => {
      if (!current() || parseFailure) return;
      try { onChunk(decoder.decodeToString(new Uint8Array(data), { stream: true })); }
      catch (error) { parseFailure = error instanceof Error ? error : new Error('任务事件解析失败');
        try { session.cancel(request); } catch (_) { /* The read may have just completed. */ } }
    } };
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 120000 } },
      tracing: { httpEventsHandler: events }
    } });
    const headers: rcp.RequestHeaders = { accept: 'text/event-stream', 'X-Study-Log-Instance': instanceId };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const request = new rcp.Request(activeInstance.apiUrl(path), 'GET', headers);
    cancellation.bind(() => { try { session.cancel(request); } catch (_) {} });
    try {
      const response = await session.fetch(request).catch(() => {
        cancellation.check();
        if (!current()) throw new ApiStreamCancelledError();
        throw parseFailure || new ApiError('任务事件连接中断，正在重新连接', 0, 'NETWORK_ERROR');
      });
      cancellation.check();
      if (!current()) throw new ApiStreamCancelledError();
      if (parseFailure) throw parseFailure;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (response.statusCode === 401 && token) this.onUnauthorized();
        throw new ApiError(`任务事件请求失败（${response.statusCode}）`, response.statusCode);
      }
      const tail = decoder.decodeToString(new Uint8Array(), { stream: false });
      if (tail) onChunk(tail);
    } finally { cancellation.release(); session.close(); }
  }

  async download(path: string): Promise<ArrayBuffer> {
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const headers: rcp.RequestHeaders = { accept: 'application/zip' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 240000 } }
    } });
    try {
      const response = await session.fetch(new rcp.Request(activeInstance.apiUrl(path), 'GET', headers)).catch(() => {
        throw new ApiError('无法连接服务器，请检查网络后重试', 0, 'NETWORK_ERROR');
      });
      if (instanceRevision !== activeInstance.revision || sessionRevision !== this.sessionRevision) {
        throw new Error('会话已切换，请重新操作');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (response.statusCode === 401 && requestToken) this.onUnauthorized();
        let payload: ApiErrorPayload = {};
        try { payload = JSON.parse(response.toString() || '') as ApiErrorPayload; } catch (_) { payload = {}; }
        throw new ApiError(payload.error || `请求失败（${response.statusCode}）`, response.statusCode, payload.code || '');
      }
      return response.body || new ArrayBuffer(0);
    } finally { session.close(); }
  }

  async postFiles<T>(path: string, files: ApiUploadFile[], noteYear: string = ''): Promise<T> {
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const headers: rcp.RequestHeaders = { accept: 'application/json' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    const uploads: rcp.FormFieldFileValue[] = files.map((file: ApiUploadFile) => new MultipartUploadFile(file));
    const form = noteYear ? new rcp.MultipartForm({ file: uploads, scope: 'notes', year: noteYear }) :
      new rcp.MultipartForm({ file: uploads });
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 240000 } }
    } });
    try {
      const response = await session.fetch(new rcp.Request(activeInstance.apiUrl(path), 'POST', headers, form)).catch(() => {
        throw new ApiError('无法连接服务器，请检查网络后重试', 0, 'NETWORK_ERROR');
      });
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
    } finally { session.close(); }
  }

  private async request<T>(path: string, method: rcp.HttpMethod, body?: object,
    cancellation?: ReadCancellation, expectedInstanceId: string = ''): Promise<T> {
    cancellation?.check();
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const headers: rcp.RequestHeaders = { 'accept': 'application/json', 'content-type': 'application/json' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    if (expectedInstanceId) headers['X-Study-Log-Instance'] = expectedInstanceId;
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: method === 'GET' ? 5000 : 15000, transferMs: method === 'GET' ? 10000 : 60000 } }
    } });

    let deadline: number = -1;
    let timedOut: boolean = false;
    try {
      const request = new rcp.Request(activeInstance.apiUrl(path), method, headers,
        body ? JSON.stringify(body) : undefined);
      cancellation?.bind(() => {
        try { session.cancel(request); }
        catch (_) { /* The read may have just completed. */ }
      });
      if (method === 'GET') deadline = setTimeout(() => { timedOut = true; try { session.cancel(request); } catch (_) {} }, 10000);
      const response = await session.fetch(request).catch((error: BusinessError) => {
        cancellation?.check();
        throw new ApiError('无法连接服务器，请检查网络后重试', 0, String(timedOut ? 1007900028 : error.code || 'NETWORK_ERROR'));
      });
      cancellation?.check();
      if (timedOut) throw new ApiError('读取超时，请重试', 0, '1007900028');
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
      clearTimeout(deadline);
      cancellation?.release();
      session.close();
    }
  }
}

export const apiClient: ApiClient = new ApiClient();

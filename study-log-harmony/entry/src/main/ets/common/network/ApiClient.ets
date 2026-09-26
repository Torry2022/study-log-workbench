import { rcp } from '@kit.RemoteCommunicationKit';
import { util } from '@kit.ArkTS';
import { activeInstance } from './InstanceConfig';

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

  setUnauthorizedHandler(handler: () => void): () => void {
    this.onUnauthorized = handler;
    return () => { if (this.onUnauthorized === handler) this.onUnauthorized = () => {}; };
  }

  get<T>(path: string): Promise<T> { return this.request<T>(path, 'GET'); }
  post<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'POST', body); }
  put<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'PUT', body); }
  patch<T>(path: string, body: object): Promise<T> { return this.request<T>(path, 'PATCH', body); }
  delete<T>(path: string, body?: object): Promise<T> { return this.request<T>(path, 'DELETE', body); }

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
        throw new Error('无法连接服务器，请检查网络后重试');
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
        throw new Error('无法连接服务器，请检查网络后重试');
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

  async postFiles<T>(path: string, files: ApiUploadFile[]): Promise<T> {
    const instanceRevision = activeInstance.revision;
    const sessionRevision = this.sessionRevision;
    const requestToken = this.token;
    const headers: rcp.RequestHeaders = { accept: 'application/json' };
    if (requestToken) headers['authorization'] = `Bearer ${requestToken}`;
    const uploads: rcp.FormFieldFileValue[] = files.map((file: ApiUploadFile) => new MultipartUploadFile(file));
    const form = new rcp.MultipartForm({ file: uploads });
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 15000, transferMs: 240000 } }
    } });
    try {
      const response = await session.fetch(new rcp.Request(activeInstance.apiUrl(path), 'POST', headers, form)).catch(() => {
        throw new Error('无法连接服务器，请检查网络后重试');
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
      const response = await session.fetch(request).catch(() => {
        throw new Error('无法连接服务器，请检查网络后重试');
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
    } finally {
      session.close();
    }
  }
}

export const apiClient: ApiClient = new ApiClient();

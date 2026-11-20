import { rcp } from '@kit.RemoteCommunicationKit';
import { ApiError } from './ApiClient';
import { InstanceCapabilities, normalizeInstanceOrigin, validCapabilities } from './InstanceConfig';
import { ReadCancellation } from './ReadCancellation';

export interface ConnectionInput { origin: string; password: string; localHttp: boolean; }
export interface ConnectionCandidate { origin: string; localHttp: boolean; token: string; capabilities: InstanceCapabilities; }
interface LoginResult { ok: boolean; token: string; expiresAt: string; }
interface FailureResult { error?: string; }

export class ConnectionProbe {
  async check(input: ConnectionInput, cancellation: ReadCancellation): Promise<ConnectionCandidate> {
    const origin = normalizeInstanceOrigin(input.origin, input.localHttp);
    if (!input.password) throw new Error('请输入访问密码');
    const login = await this.request<LoginResult>(origin, '/auth/app-login', '', input.password, cancellation);
    if (!login || login.ok !== true || typeof login.token !== 'string' || !login.token ||
      !Number.isFinite(Date.parse(login.expiresAt)) || Date.parse(login.expiresAt) <= Date.now()) {
      throw new Error('服务器登录响应无效');
    }
    const capabilities = await this.request<InstanceCapabilities>(origin, '/capabilities', login.token, '', cancellation);
    if (!validCapabilities(capabilities)) throw new Error('服务器不支持当前客户端接口');
    return { origin, localHttp: input.localHttp, token: login.token, capabilities };
  }

  private async request<T>(origin: string, path: string, token: string, password: string,
    cancellation: ReadCancellation): Promise<T> {
    cancellation.check();
    const session = rcp.createSession({ requestConfiguration: {
      transfer: { autoRedirect: false, timeout: { connectMs: 5000, transferMs: 10000 } }
    } });
    const headers: rcp.RequestHeaders = { accept: 'application/json', 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const request = new rcp.Request(origin + '/study-log/api' + path, password ? 'POST' : 'GET', headers,
      password ? JSON.stringify({ password }) : undefined);
    cancellation.bind(() => { try { session.cancel(request); } catch (_) {} });
    try {
      const response = await session.fetch(request).catch(() => { throw new Error('无法连接服务器，请检查地址、网络和 HTTPS 证书'); });
      cancellation.check();
      const raw = response.toString() || '';
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let failure: FailureResult = {};
        try { failure = JSON.parse(raw) as FailureResult; } catch (_) {}
        throw new ApiError(failure && typeof failure.error === 'string' ? failure.error : `连接失败（${response.statusCode}）`, response.statusCode);
      }
      try { return JSON.parse(raw) as T; }
      catch (_) { throw new Error('服务器响应格式异常'); }
    } finally { cancellation.release(); session.close(); }
  }
}

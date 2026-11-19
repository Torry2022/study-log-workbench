import { util } from '@kit.ArkTS';
import { ApiClient, ApiError } from '../common/network/ApiClient';
import { activeInstance, InstanceCapabilities, validCapabilities } from '../common/network/InstanceConfig';
import { ReadCancellation } from '../common/network/ReadCancellation';
import { AiSettingsSummary, aiSettingsSupport, parseAiSettingsSummary } from './AiSettingsSummary';
import { InstanceStore } from '../common/storage/InstanceStore';

interface PendingSave { instanceId: string; operationId: string; expectedRevision: number; }
interface SettingsPayload extends PendingSave {
  expectedInstanceId: string;
  provider: string;
  endpointAction: string;
  endpoint?: string;
  model: string;
  lightModel: string;
  keyAction: string;
  key?: string;
  mode?: string;
  previewId?: string;
  contextWindowTokens?: string;
  thinking?: string;
}
class AuthorizedPayload implements SettingsPayload {
  instanceId: string;
  expectedInstanceId: string;
  expectedRevision: number;
  operationId: string;
  provider: string;
  endpointAction: string;
  endpoint?: string;
  model: string;
  lightModel: string;
  keyAction: string;
  key?: string;
  mode?: string;
  previewId?: string;
  contextWindowTokens?: string;
  thinking?: string;
  password: string;
  constructor(value: SettingsPayload, password: string) {
    this.instanceId = value.instanceId; this.expectedInstanceId = value.expectedInstanceId;
    this.expectedRevision = value.expectedRevision; this.operationId = value.operationId;
    this.provider = value.provider; this.endpointAction = value.endpointAction; this.endpoint = value.endpoint;
    this.model = value.model; this.lightModel = value.lightModel; this.keyAction = value.keyAction; this.key = value.key;
    this.mode = value.mode; this.previewId = value.previewId; this.password = password;
    this.contextWindowTokens = value.contextWindowTokens; this.thinking = value.thinking;
  }
}
interface PreviewRequest { password: string; expectedInstanceId: string; expectedRevision: number | null; }
interface ProbeResult { instanceId: string; revision: number; models?: string[]; ok?: boolean; }
interface DeploymentPreview {
  instanceId: string; revision: number; previewId: string; provider: string; endpointDisplay: string;
  hasEndpoint: boolean; model: string; hasKey: boolean; lightModel: string;
}

@Observed
export class AiSettingsEditor {
  editing: boolean = false;
  busy: boolean = false;
  checking: boolean = false;
  writable: boolean = false;
  provider: string = 'deepseek';
  endpointAction: string = 'keep';
  endpoint: string = '';
  model: string = '';
  lightModel: string = '';
  contextWindowTokens: string = '';
  thinking: string = '';
  keyAction: string = 'keep';
  key: string = '';
  message: string = '';
  error: string = '';
  models: string[] = [];
  probeStatus: string = '';
  pending?: PendingSave;
  latest?: AiSettingsSummary;
  preview?: DeploymentPreview;
  private base?: AiSettingsSummary;
  private payload?: SettingsPayload;
  private binding: string = '';
  private namespace: string = '';
  private revision: number = 0;
  private cancellation?: ReadCancellation;
  private contextChanged: boolean = false;
  private thinkingChanged: boolean = false;
  private transport: ApiClient;
  private store: InstanceStore;

  constructor(transport: ApiClient, store: InstanceStore) { this.transport = transport; this.store = store; }

  dispose(): void {
    this.revision++; this.cancellation?.cancel(); this.busy = false; this.checking = false;
    this.key = ''; this.endpoint = ''; this.payload = undefined; this.preview = undefined;
    this.editing = false; this.base = undefined; this.latest = undefined; this.pending = undefined;
    this.writable = false;
  }

  private current(revision: number): boolean {
    return revision === this.revision && this.binding === this.transport.getConnectionBinding();
  }

  async open(summary: AiSettingsSummary): Promise<void> {
    if (this.busy) return;
    this.dispose();
    this.binding = this.transport.getConnectionBinding(); this.namespace = activeInstance.namespace;
    this.base = summary; this.latest = summary; this.model = summary.model; this.lightModel = summary.lightModel;
    this.provider = summary.provider; this.endpointAction = summary.hasEndpoint ? 'keep' : 'replace';
    this.contextWindowTokens = summary.contextWindowTokens; this.thinking = summary.thinking;
    this.contextChanged = false; this.thinkingChanged = false;
    this.endpoint = summary.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : '';
    this.keyAction = 'keep'; this.key = '';
    this.message = ''; this.error = ''; this.models = []; this.probeStatus = ''; this.editing = true;
    const revision = this.revision; this.busy = true; this.cancellation = new ReadCancellation();
    try {
      const raw = await this.store.readAiSettingsPending(this.namespace);
      if (!this.current(revision)) return;
      if (raw) {
        const pending = JSON.parse(raw) as PendingSave;
        if (pending.instanceId !== summary.instanceId || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pending.operationId) ||
          !Number.isSafeInteger(pending.expectedRevision) || pending.expectedRevision < 1) throw new Error('本机保存结果记录无效，请核对工作台身份');
        this.pending = { instanceId: pending.instanceId, operationId: pending.operationId, expectedRevision: pending.expectedRevision };
        await this.reconcile(revision);
      }
      await this.authorize(revision);
    } catch (error) { if (this.current(revision)) this.fail(error); }
    finally { if (this.current(revision)) this.busy = false; }
  }

  change(field: string, value: string): void {
    if (this.busy || this.pending) return;
    if (field === 'provider') {
      this.provider = value; this.endpointAction = 'replace';
      this.endpoint = value === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : '';
      this.keyAction = this.base?.hasKey ? 'replace' : 'keep'; this.key = ''; this.models = [];
    } else if (field === 'endpointAction') {
      this.endpointAction = value; this.keyAction = this.base?.hasKey ? 'replace' : 'keep'; this.key = '';
    } else if (field === 'endpoint') {
      this.endpoint = value; this.keyAction = this.base?.hasKey ? 'replace' : 'keep'; this.key = ''; this.models = [];
    } else if (field === 'model') this.model = value;
    else if (field === 'lightModel') this.lightModel = value;
    else if (field === 'keyAction') { this.keyAction = value; this.key = ''; }
    else if (field === 'key') this.key = value;
    else if (field === 'contextWindowTokens') { this.contextWindowTokens = value; this.contextChanged = true; }
    else if (field === 'thinking') { this.thinking = value; this.thinkingChanged = true; }
    if (['provider', 'endpointAction', 'endpoint', 'model'].includes(field)) {
      this.contextWindowTokens = ''; this.contextChanged = false;
    }
    this.preview = undefined; this.probeStatus = ''; this.message = ''; this.error = '';
  }

  hasUnsavedChanges(): boolean {
    if (!this.editing || !this.base) return false;
    return !!this.pending || this.provider !== this.base.provider ||
      this.endpointAction !== (this.base.hasEndpoint ? 'keep' : 'replace') ||
      (this.endpointAction === 'replace' && this.endpoint !== (this.base.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : '')) ||
      this.model !== this.base.model || this.lightModel !== this.base.lightModel || this.keyAction !== 'keep' || !!this.key ||
      (this.contextChanged && this.contextWindowTokens !== this.base.contextWindowTokens) ||
      (this.thinkingChanged && this.thinking !== this.base.thinking);
  }

  leaveMessage(): string {
    return this.pending ? '保存结果仍在确认中，下次进入会继续核对。是否结束编辑？' : '当前修改将被放弃。是否结束编辑？';
  }

  private async authorize(revision: number): Promise<void> {
    if (!this.current(revision) || !this.base) throw new Error('工作台已变化，请重新进入设置');
    const capabilities = await this.transport.get<InstanceCapabilities>('/capabilities', this.cancellation);
    if (!this.current(revision)) throw new Error('工作台已变化，请重新进入设置');
    if (!validCapabilities(capabilities) || capabilities.instanceId !== this.base.instanceId) throw new Error('工作台身份已变化，请重新连接');
    this.writable = aiSettingsSupport(capabilities) === 'readable' && capabilities.settings?.ai?.writable === true &&
      capabilities.settings?.ai?.reauthRequired === true;
    if (!this.writable) throw new Error('模型设置由部署者管理，当前不可修改或检查');
  }

  private draft(): SettingsPayload {
    if (!this.base || this.base.revision === null) throw new Error('请重新读取已初始化的工作台设置');
    if (!['deepseek', 'custom'].includes(this.provider) || !['keep', 'replace'].includes(this.endpointAction) ||
      !['keep', 'replace', 'remove'].includes(this.keyAction)) throw new Error('请选择有效的设置动作');
    const endpointAction = this.provider === 'custom' && !this.base.hasEndpoint && !this.endpoint.trim() ? 'keep' : this.endpointAction;
    if (endpointAction === 'replace') {
      if (!/^https?:\/\/[^\s]+$/.test(this.endpoint.trim())) throw new Error('请填写完整的生成接口地址');
      if (this.keyAction === 'keep' && this.base.hasKey) throw new Error('更换接口后请重新填写或移除密钥');
    }
    if (endpointAction === 'keep' && !this.base.hasEndpoint && this.keyAction === 'replace') throw new Error('请先填写服务地址，再替换密钥');
    if (this.keyAction === 'replace' && (!this.key || /[^\x21-\x7e]/.test(this.key))) throw new Error('请填写有效的 API Key');
    if (/[\u0000-\u001f\u007f]/.test(this.model + this.lightModel)) throw new Error('模型名称包含无效字符');
    const body: SettingsPayload = { instanceId: this.base.instanceId, expectedInstanceId: this.base.instanceId,
      expectedRevision: this.base.revision, operationId: util.generateRandomUUID(), provider: this.provider,
      endpointAction, keyAction: this.keyAction, model: this.model.trim(), lightModel: this.lightModel.trim() };
    if (endpointAction === 'replace') body.endpoint = this.endpoint.trim();
    if (this.keyAction === 'replace') body.key = this.key;
    if (this.contextChanged) {
      const context = this.contextWindowTokens.trim();
      if (context && (!/^[1-9]\d*$/.test(context) || !Number.isSafeInteger(Number(context)) || Number(context) <= 98304)) throw new Error('请填写大于 98304 的整数容量，或留空使用默认');
      body.contextWindowTokens = context;
    }
    if (this.thinkingChanged && this.thinkingSupported()) {
      if (!['', 'disabled', 'low'].includes(this.thinking)) throw new Error('请选择有效的推理方式');
      body.thinking = this.thinking;
    }
    return body;
  }

  thinkingSupported(): boolean {
    const official = this.endpointAction === 'keep' ? this.base?.provider === 'deepseek' : this.endpoint.trim() === 'https://api.deepseek.com/chat/completions';
    return this.provider === 'deepseek' && official && ['deepseek-flash', 'deepseek-v4-pro'].includes(this.model.trim());
  }

  private fail(error: Object): void {
    // Server errors use a bounded public message; never surface a native/third-party exception containing the body.
    this.error = error instanceof ApiError ? error.message :
      error instanceof Error && /^(请|模型|工作台|更换|本机|部署|此服务)/.test(error.message) ? error.message : '设置操作未完成，请重试';
  }

  async save(password: string, retry: boolean = false, restore: boolean = false): Promise<boolean> {
    if (this.busy || !this.editing || (!retry && this.pending)) return false;
    const revision = this.revision; this.cancellation = new ReadCancellation(); this.busy = true;
    this.error = ''; this.message = ''; let sent = false, writeCompleted = false;
    const priorPending = this.pending;
    try {
      if (!password) throw new Error('请再次输入工作台访问密码');
      await this.authorize(revision);
      let payload: SettingsPayload | undefined;
      if (restore) {
        if (!this.preview || this.preview.instanceId !== this.base?.instanceId || this.preview.revision !== this.base.revision) throw new Error('请重新核对部署配置');
        payload = { instanceId: this.preview.instanceId, expectedInstanceId: this.preview.instanceId,
          expectedRevision: this.preview.revision as number, operationId: util.generateRandomUUID(),
          provider: this.preview.provider, model: this.preview.model, lightModel: this.preview.lightModel,
          endpointAction: 'keep', keyAction: 'keep', mode: 'restore_deployment', previewId: this.preview.previewId };
      } else payload = retry ? this.payload : this.draft();
      if (!payload) throw new Error('请核对最新设置后重新填写秘密字段');
      const pending: PendingSave = { instanceId: payload.expectedInstanceId, operationId: payload.operationId, expectedRevision: payload.expectedRevision };
      await this.store.writeAiSettingsPending(this.namespace, JSON.stringify(pending));
      if (!this.current(revision)) return false;
      this.pending = pending; this.payload = payload;
      const body = new AuthorizedPayload(payload, password);
      sent = true;
      await this.transport.putForInstance<object>('/settings/ai', body, pending.instanceId, this.cancellation);
      writeCompleted = true;
      if (!this.current(revision)) return false;
      return await this.reconcile(revision);
    } catch (error) {
      if (!this.current(revision)) return false;
      if (sent && (writeCompleted || priorPending || !(error instanceof ApiError) || error.statusCode === 0 || error.statusCode >= 500 || error.statusCode < 300)) {
        this.message = '保存结果暂时无法确认，请核对结果；不会自动重复写入。';
        if (error instanceof ApiError && ['AI_SETTINGS_INSTANCE_CHANGED', 'AI_SETTINGS_REAUTH_FAILED', 'AI_SETTINGS_CONFLICT'].includes(error.code)) this.fail(error);
      } else {
        if (this.pending && !priorPending) {
          try { await this.store.writeAiSettingsPending(this.namespace, ''); this.pending = undefined; this.payload = undefined; }
          catch (_) { this.message = '本机结果记录尚未清除，请重新核对。'; }
        }
        if (this.current(revision)) this.fail(error);
      }
    } finally { password = ''; if (this.current(revision)) this.busy = false; }
    return false;
  }

  private async reconcile(revision: number): Promise<boolean> {
    if (!this.pending) return false;
    const latest = parseAiSettingsSummary(await this.transport.getForInstance<AiSettingsSummary>('/settings/ai', this.pending.instanceId, this.cancellation), this.pending.instanceId);
    if (!this.current(revision)) return false;
    this.latest = latest;
    if (latest.operationId === this.pending.operationId && latest.revision !== null && latest.revision > this.pending.expectedRevision) {
      await this.store.writeAiSettingsPending(this.namespace, '');
      if (!this.current(revision)) return false;
      this.pending = undefined; this.payload = undefined; this.key = ''; this.endpoint = '';
      this.base = latest; this.model = latest.model; this.lightModel = latest.lightModel; this.provider = latest.provider;
      this.contextWindowTokens = latest.contextWindowTokens; this.thinking = latest.thinking;
      this.contextChanged = false; this.thinkingChanged = false;
      this.endpointAction = latest.hasEndpoint ? 'keep' : 'replace'; this.keyAction = 'keep';
      this.preview = undefined; this.probeStatus = ''; this.message = '设置已保存，新开始的任务将使用新配置。';
      try {
        const capabilities = await this.transport.get<InstanceCapabilities>('/capabilities', this.cancellation);
        if (!this.current(revision)) return false;
        if (!validCapabilities(capabilities) || capabilities.instanceId !== latest.instanceId) throw new Error('工作台身份已变化');
        activeInstance.capabilities = capabilities;
        this.writable = aiSettingsSupport(capabilities) === 'readable' && capabilities.settings?.ai?.writable === true && capabilities.settings?.ai?.reauthRequired === true;
        return true;
      } catch (_) { if (this.current(revision)) this.message = '设置已保存；功能状态暂未更新，请重新读取。'; }
    } else this.message = latest.revision === this.pending.expectedRevision ?
      '暂未确认本次保存。可继续核对，或保持原内容重试；关闭后秘密字段不会保留。' :
      'AI 设置已在另一台设备更新，本次保存结果无法确认。请核对最新设置后重新填写。';
    return false;
  }

  async checkSave(): Promise<boolean> {
    if (this.busy || !this.pending) return false;
    const revision = this.revision; this.busy = true; this.cancellation = new ReadCancellation(); this.error = '';
    try { return await this.reconcile(revision); } catch (error) { if (this.current(revision)) this.fail(error); }
    finally { if (this.current(revision)) this.busy = false; }
    return false;
  }

  canRetry(): boolean { return !!this.pending && !!this.payload && this.latest?.revision === this.pending.expectedRevision; }

  async useLatest(): Promise<void> {
    if (this.busy || !this.latest) return;
    const revision = this.revision; const latest = this.latest; this.busy = true;
    try {
      await this.store.writeAiSettingsPending(this.namespace, '');
      if (!this.current(revision)) return;
      this.busy = false; await this.open(latest);
    } catch (error) { if (this.current(revision)) { this.busy = false; this.fail(error); } }
  }

  async reviewLatest(): Promise<void> {
    if (this.busy || !this.base) return;
    const revision = this.revision; this.busy = true; this.cancellation = new ReadCancellation();
    try {
      const summary = parseAiSettingsSummary(await this.transport.getForInstance<AiSettingsSummary>('/settings/ai', this.base.instanceId, this.cancellation), this.base.instanceId);
      if (this.current(revision)) { this.latest = summary; this.message = '已读取最新摘要；当前填写仍保留，按最新设置重新填写前请核对。'; }
    } catch (error) { if (this.current(revision)) this.fail(error); }
    finally { if (this.current(revision)) this.busy = false; }
  }

  async probe(kind: string, password: string): Promise<void> {
    if (this.busy || this.pending || !this.editing) return;
    const revision = this.revision; this.busy = true; this.checking = true; this.error = ''; this.probeStatus = '';
    this.cancellation = new ReadCancellation();
    try {
      if (!password) throw new Error('请再次输入工作台访问密码');
      if (!['models', 'test'].includes(kind)) throw new Error('请选择检查动作');
      await this.authorize(revision);
      const draft = this.draft();
      if (draft.endpointAction === 'replace' ? !draft.endpoint : !this.base?.hasEndpoint) throw new Error('请填写完整的生成接口地址');
      if (draft.keyAction === 'remove' || draft.keyAction === 'keep' && !this.base?.hasKey) throw new Error('请填写有效的 API Key');
      if (kind === 'test' && !draft.model) throw new Error('请填写模型名称');
      if (kind === 'models' && draft.provider !== 'deepseek') throw new Error('此服务请手动填写模型名称');
      const body = new AuthorizedPayload(draft, password);
      const result = await this.transport.postForInstance<ProbeResult>(kind === 'models' ? '/settings/ai/models' : '/settings/ai/test', body, draft.expectedInstanceId, this.cancellation);
      if (!this.current(revision)) return;
      if (result.instanceId !== draft.expectedInstanceId || result.revision !== draft.expectedRevision) throw new Error('工作台设置已变化，请重新读取');
      if (kind === 'models') {
        if (!Array.isArray(result.models) || result.models.length > 200 || result.models.some(value => typeof value !== 'string' || !value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('模型列表响应无效');
        this.models = result.models; this.probeStatus = '已读取模型列表，不代表生成或工具调用已通过。';
      } else {
        if (result.ok !== true) throw new Error('模型检查响应无效');
        this.probeStatus = '生成检查通过';
      }
    } catch (error) { if (this.current(revision)) this.fail(error); }
    finally { password = ''; if (this.current(revision)) { this.busy = false; this.checking = false; } }
  }

  cancelProbe(): void {
    if (!this.checking || this.pending) return;
    this.revision++; this.cancellation?.cancel(); this.cancellation = undefined;
    this.busy = false; this.checking = false; this.probeStatus = ''; this.models = []; this.preview = undefined;
    this.message = '已停止等待检查结果；再次检查将发起新请求。';
  }

  async previewDeployment(password: string): Promise<void> {
    if (this.busy || this.pending || !this.base) return;
    const revision = this.revision; this.busy = true; this.error = ''; this.preview = undefined;
    this.cancellation = new ReadCancellation();
    try {
      if (!password) throw new Error('请再次输入工作台访问密码');
      await this.authorize(revision);
      const body: PreviewRequest = { password, expectedInstanceId: this.base.instanceId, expectedRevision: this.base.revision };
      const response = await this.transport.postForInstance<DeploymentPreview>('/settings/ai/deployment-preview', body, this.base.instanceId, this.cancellation);
      if (!this.current(revision)) return;
      const safe: AiSettingsSummary = { instanceId: response.instanceId, revision: response.revision,
        provider: response.provider, endpointDisplay: response.endpointDisplay, hasEndpoint: response.hasEndpoint,
        model: response.model, hasKey: response.hasKey, lightModel: response.lightModel,
        contextWindowTokens: '', thinking: '', toolCallingVerified: false, statusVerificationEnabled: false, source: 'deployment' };
      const summary = parseAiSettingsSummary(safe, this.base.instanceId);
      if (summary.revision !== this.base.revision || typeof response.previewId !== 'string' || !response.previewId) throw new Error('部署预览已变化，请重新核对');
      this.preview = { instanceId: summary.instanceId, revision: response.revision,
        provider: summary.provider, endpointDisplay: summary.endpointDisplay, hasEndpoint: summary.hasEndpoint,
        model: summary.model, hasKey: summary.hasKey, lightModel: summary.lightModel,
        previewId: response.previewId };
      this.message = '请核对部署配置摘要，再次确认密码后恢复。';
    } catch (error) { if (this.current(revision)) this.fail(error); }
    finally { password = ''; if (this.current(revision)) this.busy = false; }
  }
}

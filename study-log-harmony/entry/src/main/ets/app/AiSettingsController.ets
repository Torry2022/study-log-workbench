import { ApiClient, ApiError } from '../common/network/ApiClient';
import { InstanceCapabilities, validCapabilities } from '../common/network/InstanceConfig';
import { ReadCancellation } from '../common/network/ReadCancellation';
import { AiSettingsSummary, AiSettingsSupport, aiSettingsSupport, parseAiSettingsSummary } from './AiSettingsSummary';

@Observed
export class AiSettingsController {
  loading: boolean = false;
  support: AiSettingsSupport = 'legacy';
  summary?: AiSettingsSummary;
  readiness?: InstanceCapabilities;
  error: string = '';
  writable: boolean = false;
  private onLoaded: (summary: AiSettingsSummary) => void;
  private revision: number = 0;
  private cancellation?: ReadCancellation;
  private transport: ApiClient;
  private capabilities: () => InstanceCapabilities | undefined;

  constructor(transport: ApiClient, capabilities: () => InstanceCapabilities | undefined,
    onLoaded: (summary: AiSettingsSummary) => void = () => {}) {
    this.transport = transport;
    this.capabilities = capabilities;
    this.onLoaded = onLoaded;
  }

  dispose(): void { this.revision++; this.cancellation?.cancel(); this.loading = false; }

  async load(refresh: boolean = false): Promise<void> {
    if (this.loading) return;
    const revision = ++this.revision, binding = this.transport.getConnectionBinding();
    const cancellation = new ReadCancellation();
    this.cancellation = cancellation;
    const current = (): boolean => revision === this.revision && binding === this.transport.getConnectionBinding();
    const initial = this.capabilities();
    this.summary = undefined;
    this.readiness = undefined;
    this.error = '';
    this.writable = false;
    this.loading = true;
    try {
      if (!initial) throw new Error('请先连接工作台');
      const capabilities = refresh ? await this.transport.get<InstanceCapabilities>('/capabilities', cancellation) : initial;
      if (!current()) return;
      if (!validCapabilities(capabilities) || capabilities.instanceId !== initial.instanceId) {
        throw new Error('工作台身份已变化，请重新连接');
      }
      this.readiness = capabilities;
      this.support = aiSettingsSupport(capabilities);
      this.writable = this.support === 'readable' && capabilities.settings?.ai?.writable === true && capabilities.settings?.ai?.reauthRequired === true;
      if (this.support !== 'readable') return;
      const response = await this.transport.getForInstance<AiSettingsSummary>('/settings/ai', initial.instanceId, cancellation);
      if (!current()) return;
      this.summary = parseAiSettingsSummary(response, initial.instanceId);
      this.onLoaded(this.summary);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.code === 'AI_SETTINGS_INSTANCE_CHANGED') {
        this.error = '工作台身份已变化，请重新连接；原有草稿仍保留在此设备。';
      } else if (error instanceof ApiError && error.code === 'AI_CONFIGURATION_INVALID') {
        this.error = '模型设置无法读取，请由部署者检查工作台配置；此错误不代表尚未配置。';
      } else {
        this.error = error instanceof Error ? error.message : '模型设置读取失败，请重试';
      }
    } finally { if (revision === this.revision) this.loading = false; }
  }
}

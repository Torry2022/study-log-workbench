import type { InstanceCapabilities } from '../common/network/InstanceConfig';

export type AiSettingsSupport = 'readable' | 'legacy' | 'unavailable' | 'unsupported';

export function aiSettingsSupport(capabilities?: InstanceCapabilities): AiSettingsSupport {
  const ai = capabilities?.settings?.ai;
  if (ai === undefined) return 'legacy';
  if (!ai || ai.protocolVersion !== 1 || typeof ai.readable !== 'boolean' || typeof ai.writable !== 'boolean' ||
    typeof ai.reason !== 'string' || typeof ai.reauthRequired !== 'boolean') return 'unsupported';
  return ai.readable ? 'readable' : 'unavailable';
}

export interface AiSettingsSummary {
  instanceId: string;
  revision: number | null;
  operationId?: string | null;
  provider: string;
  endpointDisplay: string;
  hasEndpoint: boolean;
  model: string;
  hasKey: boolean;
  lightModel: string;
  contextWindowTokens: string;
  thinking: string;
  toolCallingVerified: boolean;
  statusVerificationEnabled: boolean;
  source: string;
}

// Only the frozen, non-secret read summary is retained. Never use this as a write payload.
export function parseAiSettingsSummary(value: AiSettingsSummary, instanceId: string): AiSettingsSummary {
  if (!value || value.instanceId !== instanceId ||
    (value.revision !== null && (!Number.isSafeInteger(value.revision) || value.revision < 1)) ||
    (value.source === 'instance' && value.revision === null) ||
    !['instance', 'deployment'].includes(value.source) || !['deepseek', 'custom'].includes(value.provider) ||
    typeof value.hasEndpoint !== 'boolean' || typeof value.hasKey !== 'boolean' ||
    typeof value.model !== 'string' || typeof value.lightModel !== 'string' ||
    typeof value.contextWindowTokens !== 'string' || typeof value.thinking !== 'string' ||
    typeof value.toolCallingVerified !== 'boolean' || typeof value.statusVerificationEnabled !== 'boolean' ||
    typeof value.endpointDisplay !== 'string' ||
    (value.endpointDisplay !== '' && !/^https?:\/\/(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.test(value.endpointDisplay))) {
    throw new Error('模型设置响应无效，请重新读取');
  }
  if (value.operationId !== undefined && value.operationId !== null &&
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.operationId)) throw new Error('模型设置操作身份无效');
  const result: AiSettingsSummary = { instanceId: value.instanceId, revision: value.revision, provider: value.provider,
    endpointDisplay: value.endpointDisplay, hasEndpoint: value.hasEndpoint, model: value.model,
    hasKey: value.hasKey, lightModel: value.lightModel, contextWindowTokens: value.contextWindowTokens,
    thinking: value.thinking, toolCallingVerified: value.toolCallingVerified,
    statusVerificationEnabled: value.statusVerificationEnabled, source: value.source };
  if (value.operationId !== undefined) result.operationId = value.operationId;
  return result;
}

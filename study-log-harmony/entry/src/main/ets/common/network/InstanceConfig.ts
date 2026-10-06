export interface FeatureCapability { supported: boolean; configured: boolean; }
export interface AiProviderConfiguration { configured: boolean; }
export interface AiConfiguration { provider: AiProviderConfiguration; }
export interface InstanceFeatures {
  aiWriting: FeatureCapability;
  aiHighlighting: FeatureCapability;
  aiNoteExtraction: FeatureCapability;
  aiTaxonomy: FeatureCapability;
  rag: FeatureCapability;
}
export interface InstanceCapabilities {
  instanceId: string;
  apiContractVersion: number;
  features: InstanceFeatures;
  aiConfiguration?: AiConfiguration;
}

// The setting is an origin. The application owns the fixed /study-log/api prefix.
export function normalizeInstanceOrigin(input: string, allowLocalHttp: boolean = false): string {
  const match = /^(https?):\/\/([a-zA-Z0-9.-]+|\[::1\])(?::(\d{1,5}))?(?:\/study-log)?\/?$/.exec(input.trim());
  if (!match) throw new Error('请输入 HTTPS 服务器地址，可包含 /study-log，不含账号或查询参数');
  const host = match[2].toLowerCase();
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) throw new Error('服务器地址无效');
  const port = match[3] ? Number(match[3]) : 0;
  if (match[3] && (port < 1 || port > 65535)) throw new Error('端口无效');
  const octets = host.split('.');
  const ipv4 = octets.length === 4 && octets.every((part: string) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
  const local = host === 'localhost' || host === '[::1]' || (ipv4 && (Number(octets[0]) === 127 ||
    Number(octets[0]) === 10 || (Number(octets[0]) === 192 && Number(octets[1]) === 168) ||
    (Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31)));
  if (match[1] === 'http' && (!allowLocalHttp || !local)) throw new Error('HTTP 仅允许明确启用的本地或局域网测试地址');
  return `${match[1]}://${host}${port && !((match[1] === 'https' && port === 443) || (match[1] === 'http' && port === 80)) ? ':' + port : ''}`;
}

function validFeature(feature: FeatureCapability): boolean {
  return !!feature && typeof feature.supported === 'boolean' && typeof feature.configured === 'boolean';
}

export function validCapabilities(value: InstanceCapabilities): boolean {
  return !!value && value.apiContractVersion === 1 &&
    typeof value.instanceId === 'string' &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.instanceId) &&
    !!value.features && validFeature(value.features.aiWriting) && validFeature(value.features.aiHighlighting) &&
    validFeature(value.features.aiNoteExtraction) && validFeature(value.features.aiTaxonomy) &&
    validFeature(value.features.rag) && (value.aiConfiguration === undefined ||
      (!!value.aiConfiguration && !!value.aiConfiguration.provider &&
        typeof value.aiConfiguration.provider.configured === 'boolean'));
}

class ActiveInstance {
  origin: string = '';
  namespace: string = '';
  revision: number = 0;
  capabilities?: InstanceCapabilities;

  activate(origin: string, namespace: string, capabilities?: InstanceCapabilities): void {
    this.revision++;
    this.origin = origin;
    this.namespace = namespace;
    this.capabilities = capabilities;
  }

  apiUrl(path: string): string {
    if (!this.origin || !/^\/[a-z][a-zA-Z0-9/?=&%_.-]*$/.test(path) || path.includes('..')) {
      throw new Error('服务器或接口地址无效');
    }
    return `${this.origin}/study-log/api${path}`;
  }
}

export const activeInstance = new ActiveInstance();

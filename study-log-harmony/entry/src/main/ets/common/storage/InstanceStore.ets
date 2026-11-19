import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { activeInstance, InstanceCapabilities, normalizeInstanceOrigin } from '../network/InstanceConfig';
import { ConnectionSelectionStore } from './ConnectionSelectionStore';

export interface SavedInstance { origin: string; namespace: string; instanceId: string; localHttp: boolean; credentialId?: string; }

export class InstanceStore {
  private store?: preferences.Preferences;
  private selection?: ConnectionSelectionStore;

  async initialize(context: common.Context): Promise<void> {
    this.store = await preferences.getPreferences(context, { name: 'public-instance-settings' });
    this.selection = new ConnectionSelectionStore(context.filesDir);
  }

  async restore(): Promise<SavedInstance | undefined> {
    const raw = this.selection?.read() ?? await this.store?.get('current', '') as string;
    if (!raw) return undefined;
    try {
      const saved = JSON.parse(raw) as SavedInstance;
      if (typeof saved.localHttp !== 'boolean') return undefined;
      if (saved.credentialId !== undefined && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.credentialId)) return undefined;
      saved.origin = normalizeInstanceOrigin(saved.origin, saved.localHttp);
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.namespace) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.instanceId)) return undefined;
      return saved;
    } catch (_) { return undefined; }
  }

  async select(origin: string, capabilities: InstanceCapabilities, localHttp: boolean): Promise<void> {
    const saved = await this.prepare(origin, capabilities, localHttp);
    this.commit(saved, capabilities);
  }

  async connectionDeferred(): Promise<boolean> {
    return await this.store?.get('connection-deferred', false) === true;
  }

  async setConnectionDeferred(value: boolean): Promise<void> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    await this.store.put('connection-deferred', value);
    await this.store.flush();
  }

  async prepare(origin: string, capabilities: InstanceCapabilities, localHttp: boolean): Promise<SavedInstance> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    const key = `instance:${origin}:${capabilities.instanceId}`;
    let namespace = await this.store.get(key, '') as string;
    if (!namespace) { namespace = util.generateRandomUUID(); await this.store.put(key, namespace); }
    const saved: SavedInstance = { origin, namespace, instanceId: capabilities.instanceId, localHttp };
    await this.store.flush();
    return saved;
  }

  commit(saved: SavedInstance, capabilities: InstanceCapabilities): void {
    if (!this.selection) throw new Error('连接设置尚未初始化');
    this.selection.write(JSON.stringify(saved));
    activeInstance.activate(saved.origin, saved.namespace, capabilities, saved.credentialId || '');
  }

  async readQaPending(namespace: string): Promise<string> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    return await this.store.get(`rag-pending-v2:${namespace}`, '[]') as string;
  }

  async readAiSettingsPending(namespace: string): Promise<string> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    return await this.store.get(`ai-settings-pending:${namespace}`, '') as string;
  }

  async writeAiSettingsPending(namespace: string, raw: string): Promise<void> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    await this.store.put(`ai-settings-pending:${namespace}`, raw);
    await this.store.flush();
  }

  async writeQaPending(namespace: string, raw: string): Promise<void> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    await this.store.put(`rag-pending-v2:${namespace}`, raw);
    await this.store.flush();
  }

  async readLegacyQaPending(namespace: string): Promise<string> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    return await this.store.get(`rag-pending:${namespace}`, '[]') as string;
  }

  async clearLegacyQaPending(namespace: string): Promise<void> {
    if (!this.store) throw new Error('连接设置尚未初始化');
    await this.store.put(`rag-pending:${namespace}`, '[]');
    await this.store.flush();
  }
}

export const instanceStore = new InstanceStore();

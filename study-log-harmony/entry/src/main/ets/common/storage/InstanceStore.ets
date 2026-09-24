import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { activeInstance, InstanceCapabilities, normalizeInstanceOrigin } from '../network/InstanceConfig';

export interface SavedInstance { origin: string; namespace: string; instanceId: string; localHttp: boolean; }

export class InstanceStore {
  private store?: preferences.Preferences;

  async initialize(context: common.Context): Promise<void> {
    this.store = await preferences.getPreferences(context, { name: 'public-instance-settings' });
  }

  async restore(): Promise<SavedInstance | undefined> {
    const raw = await this.store?.get('current', '') as string;
    if (!raw) return undefined;
    try {
      const saved = JSON.parse(raw) as SavedInstance;
      if (typeof saved.localHttp !== 'boolean') return undefined;
      saved.origin = normalizeInstanceOrigin(saved.origin, saved.localHttp);
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.namespace) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved.instanceId)) return undefined;
      return saved;
    } catch (_) { return undefined; }
  }

  async select(origin: string, capabilities: InstanceCapabilities, localHttp: boolean): Promise<void> {
    if (!this.store) throw new Error('实例设置尚未初始化');
    const key = `instance:${origin}:${capabilities.instanceId}`;
    let namespace = await this.store.get(key, '') as string;
    if (!namespace) { namespace = util.generateRandomUUID(); await this.store.put(key, namespace); }
    const saved: SavedInstance = { origin, namespace, instanceId: capabilities.instanceId, localHttp };
    await this.store.put('current', JSON.stringify(saved));
    await this.store.flush();
    activeInstance.activate(origin, namespace, capabilities);
  }
}

export const instanceStore = new InstanceStore();

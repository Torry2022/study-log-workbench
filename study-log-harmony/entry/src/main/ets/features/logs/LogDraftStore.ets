import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { parseLogDraft, PreservedLogDraft } from './LogDraftPolicy';

export class LogDraftStore {
  private store?: preferences.Preferences;
  private lastValues: Map<string, string> = new Map();

  async initialize(context: common.Context): Promise<void> {
    if (!this.store) this.store = await preferences.getPreferences(context.getApplicationContext(),
      { name: 'public-log-drafts' });
  }

  load(namespace: string): PreservedLogDraft | undefined {
    if (!this.store || !namespace) return undefined;
    const raw = this.store.getSync(namespace, '') as string;
    const draft = parseLogDraft(raw, namespace);
    if (draft) this.lastValues.set(namespace, raw);
    else if (raw) this.clear(namespace);
    return draft;
  }

  save(draft: PreservedLogDraft): void {
    if (!this.store) throw new Error('草稿存储尚未初始化');
    const raw = JSON.stringify(draft);
    if (this.lastValues.get(draft.namespace) === raw) return;
    this.store.putSync(draft.namespace, raw);
    this.store.flushSync();
    this.lastValues.set(draft.namespace, raw);
  }

  clear(namespace: string): void {
    if (!this.store || !namespace) return;
    if (!this.store.hasSync(namespace)) { this.lastValues.delete(namespace); return; }
    this.store.deleteSync(namespace);
    this.store.flushSync();
    this.lastValues.delete(namespace);
  }
}

export const logDraftStore = new LogDraftStore();

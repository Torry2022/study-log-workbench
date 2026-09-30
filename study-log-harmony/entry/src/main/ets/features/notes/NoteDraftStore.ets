import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

export interface PreservedNoteDraft {
  namespace: string;
  editingId: string;
  clientId: string;
  title: string;
  body: string;
  insight: string;
  sourcesText: string;
  tagsText: string;
  recordedAt: string;
  baseVersion: string;
  baseline: string;
}

export class NoteDraftStore {
  private store?: preferences.Preferences;

  async initialize(context: common.Context): Promise<void> {
    if (!this.store) this.store = await preferences.getPreferences(context.getApplicationContext(),
      { name: 'public-note-drafts' });
  }

  load(namespace: string): PreservedNoteDraft | undefined {
    if (!this.store || !namespace) return undefined;
    try {
      const draft = JSON.parse(this.store.getSync(namespace, '') as string) as PreservedNoteDraft;
      if (!draft || draft.namespace !== namespace ||
        typeof draft.editingId !== 'string' || typeof draft.clientId !== 'string' ||
        typeof draft.title !== 'string' || typeof draft.body !== 'string' ||
        typeof draft.insight !== 'string' || typeof draft.sourcesText !== 'string' ||
        typeof draft.tagsText !== 'string' || typeof draft.recordedAt !== 'string' ||
        typeof draft.baseVersion !== 'string' || typeof draft.baseline !== 'string') return undefined;
      return draft;
    } catch (_) { return undefined; }
  }

  save(draft: PreservedNoteDraft): void {
    if (!this.store) throw new Error('随记草稿存储尚未初始化');
    this.store.putSync(draft.namespace, JSON.stringify(draft));
    this.store.flushSync();
  }

  clear(namespace: string): void {
    if (!this.store || !namespace || !this.store.hasSync(namespace)) return;
    this.store.deleteSync(namespace);
    this.store.flushSync();
  }
}

export const noteDraftStore = new NoteDraftStore();

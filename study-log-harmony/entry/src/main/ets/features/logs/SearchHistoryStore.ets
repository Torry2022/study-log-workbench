import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

export class SearchHistoryStore {
  private store?: preferences.Preferences;

  async load(context: common.Context, namespace: string): Promise<string[]> {
    if (!namespace) return [];
    try {
      this.store = await preferences.getPreferences(context.getApplicationContext(),
        { name: `study_log_search_${namespace}` });
      const value = await this.store.get('history', []);
      if (!Array.isArray(value)) return [];
      return (value as string[]).filter((item: string) => typeof item === 'string' && !!item.trim()).slice(0, 8);
    } catch (_) { return []; }
  }

  async save(items: string[]): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.put('history', items.slice(0, 8));
      await this.store.flush();
    } catch (_) { /* Current-session history remains usable. */ }
  }
}

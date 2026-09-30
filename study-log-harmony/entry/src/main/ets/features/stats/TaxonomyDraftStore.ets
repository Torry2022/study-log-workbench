import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { Taxonomy, TaxonomySuggestion } from './TaxonomyModels';

export interface PreservedTaxonomyDraft {
  namespace: string;
  taxonomy: Taxonomy;
  baseVersion: string | null;
  domainDraft: string;
  suggestions: TaxonomySuggestion[];
}

export class TaxonomyDraftStore {
  private store?: preferences.Preferences;

  async initialize(context: common.Context): Promise<void> {
    if (!this.store) this.store = await preferences.getPreferences(context.getApplicationContext(),
      { name: 'public-taxonomy-drafts' });
  }

  load(namespace: string): PreservedTaxonomyDraft | undefined {
    if (!this.store || !namespace) return undefined;
    try {
      const draft = JSON.parse(this.store.getSync(namespace, '') as string) as PreservedTaxonomyDraft;
      if (!draft || draft.namespace !== namespace || !draft.taxonomy ||
        !Array.isArray(draft.taxonomy.domains) || !draft.taxonomy.mappings ||
        typeof draft.taxonomy.mappings !== 'object' ||
        !(draft.baseVersion === null || typeof draft.baseVersion === 'string') ||
        typeof draft.domainDraft !== 'string' || !Array.isArray(draft.suggestions)) return undefined;
      return draft;
    } catch (_) { return undefined; }
  }

  save(draft: PreservedTaxonomyDraft): void {
    if (!this.store) throw new Error('分类草稿存储尚未初始化');
    this.store.putSync(draft.namespace, JSON.stringify(draft));
    this.store.flushSync();
  }

  clear(namespace: string): void {
    if (!this.store || !namespace || !this.store.hasSync(namespace)) return;
    this.store.deleteSync(namespace);
    this.store.flushSync();
  }
}

export const taxonomyDraftStore = new TaxonomyDraftStore();

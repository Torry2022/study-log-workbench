import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { Taxonomy, TaxonomyCatalogItem, TaxonomyResponse, TaxonomySaveRequest, TaxonomySaveResponse,
  TaxonomySuggestion, TaxonomySuggestionResponse, TaxonomySuggestionResultItem, TaxonomySuggestionRequest,
  TaxonomySuggestionRequestItem } from './TaxonomyModels';
import { PreservedTaxonomyDraft } from './TaxonomyDraftStore';

@Observed
export class TaxonomyController {
  taxonomy: Taxonomy = { domains: [], mappings: {}, updatedAt: null, version: null };
  savedTaxonomy: Taxonomy = { domains: [], mappings: {}, updatedAt: null, version: null };
  catalog: TaxonomyCatalogItem[] = [];
  loading: boolean = true;
  busy: boolean = false;
  loadFailed: boolean = false;
  conflict: boolean = false;
  errorMessage: string = '';
  suggestions: TaxonomySuggestion[] = [];
  suggestionBusy: boolean = false;
  suggestionMessage: string = '';
  suggestionError: boolean = false;
  private revision: number = 0;
  private suggestionRevision: number = 0;
  private suggestionSnapshot?: Taxonomy;
  private transport: ApiClient;
  private changed: () => void;

  constructor(transport: ApiClient, changed: () => void) {
    this.transport = transport;
    this.changed = changed;
  }

  dispose(): void { this.revision++; this.suggestionRevision++; }

  private copy(source: Taxonomy): Taxonomy {
    const mappings: Record<string, string> = {};
    Object.keys(source.mappings).forEach((tag: string) => mappings[tag] = source.mappings[tag]);
    return { domains: source.domains.slice(), mappings: mappings, updatedAt: source.updatedAt, version: source.version };
  }

  hasChanges(): boolean {
    return JSON.stringify(this.taxonomy.domains) !== JSON.stringify(this.savedTaxonomy.domains) ||
      JSON.stringify(this.taxonomy.mappings) !== JSON.stringify(this.savedTaxonomy.mappings);
  }

  hasPendingSuggestions(): boolean { return this.suggestions.length > 0; }

  restoreDraft(draft: PreservedTaxonomyDraft): void {
    this.taxonomy = this.copy(draft.taxonomy);
    this.suggestions = draft.suggestions.map((item: TaxonomySuggestion): TaxonomySuggestion =>
      ({ tag: item.tag, domain: item.domain, confidence: item.confidence, selected: item.selected }));
    const versionChanged = this.savedTaxonomy.version !== draft.baseVersion;
    this.conflict = versionChanged && (this.hasChanges() || this.hasPendingSuggestions());
    this.suggestionSnapshot = !versionChanged && !this.hasChanges() && this.hasPendingSuggestions() ?
      this.copy(this.savedTaxonomy) : undefined;
    if (this.conflict) this.errorMessage = '服务器分类版本已变化，本机草稿仍保留；请核对后重新读取，不能直接覆盖保存';
    this.changed();
  }

  private same(left: Taxonomy, right: Taxonomy): boolean {
    return left.version === right.version && JSON.stringify(left.domains) === JSON.stringify(right.domains) &&
      JSON.stringify(left.mappings) === JSON.stringify(right.mappings);
  }

  private sameValues(left: Taxonomy, right: Taxonomy): boolean {
    const tags = Object.keys(left.mappings);
    return JSON.stringify(left.domains) === JSON.stringify(right.domains) &&
      tags.length === Object.keys(right.mappings).length &&
      tags.every((tag: string) => left.mappings[tag] === right.mappings[tag]);
  }

  private invalidateSuggestions(): void {
    this.suggestionRevision++;
    this.suggestionBusy = false;
    this.suggestions = [];
    this.suggestionSnapshot = undefined;
    this.suggestionMessage = '';
    this.suggestionError = false;
  }

  discardSuggestions(): void { this.invalidateSuggestions(); this.changed(); }

  async requestSuggestions(items: TaxonomyCatalogItem[]): Promise<void> {
    if (this.loading || this.busy || this.loadFailed || this.conflict || this.suggestionBusy ||
      this.hasChanges() || !this.savedTaxonomy.domains.some((domain: string) => domain !== '其他')) {
      this.suggestionMessage = '请先保存自定义领域及当前分类修改'; this.suggestionError = true; this.changed(); return;
    }
    if (items.length < 1 || items.length > 200) {
      this.suggestionMessage = '请通过筛选将本次标签范围控制在 1 至 200 个'; this.suggestionError = true; this.changed(); return;
    }
    const revision = ++this.suggestionRevision;
    const snapshot = this.copy(this.savedTaxonomy);
    this.suggestionBusy = true;
    this.suggestions = [];
    this.suggestionSnapshot = undefined;
    this.suggestionMessage = '';
    this.suggestionError = false;
    this.changed();
    try {
      const requested = items.map((item: TaxonomyCatalogItem) => item.tag);
      const requestItems: TaxonomySuggestionRequestItem[] = items.map((item: TaxonomyCatalogItem): TaxonomySuggestionRequestItem =>
        ({ tag: item.tag, sources: item.sources.slice(0, 4) }));
      const request: TaxonomySuggestionRequest = { items: requestItems };
      const response = await this.transport.post<TaxonomySuggestionResponse>('/taxonomy/suggest',
        request);
      if (revision !== this.suggestionRevision) return;
      if (!this.same(this.taxonomy, snapshot) || !this.same(this.savedTaxonomy, snapshot) ||
        response.snapshotVersion !== snapshot.version) {
        this.suggestionMessage = '分类版本已变化，本次建议未载入；请重新读取后再请求';
        this.suggestionError = true; return;
      }
      this.suggestions = response.suggestions.filter((item: TaxonomySuggestionResultItem) =>
        requested.includes(item.tag) && snapshot.domains.includes(item.domain))
        .map((item: TaxonomySuggestionResultItem): TaxonomySuggestion => ({ tag: item.tag, domain: item.domain,
          confidence: item.confidence, selected: true }));
      this.suggestionSnapshot = this.suggestions.length > 0 ? snapshot : undefined;
      this.suggestionMessage = this.suggestions.length > 0 ? `已生成 ${this.suggestions.length} 条建议，请审核后应用到草稿` :
        response.warnings.join('；') || '本次没有可用的分类建议';
    } catch (error) {
      if (revision === this.suggestionRevision) {
        this.suggestionMessage = error instanceof ApiError ? error.message : '分类建议失败，请重试';
        this.suggestionError = true;
      }
    } finally {
      if (revision === this.suggestionRevision) { this.suggestionBusy = false; this.changed(); }
    }
  }

  updateSuggestion(tag: string, domain: string, selected: boolean): void {
    if (this.suggestionBusy || !this.suggestionSnapshot || !this.suggestionSnapshot.domains.includes(domain)) return;
    this.suggestions = this.suggestions.map((item: TaxonomySuggestion) => item.tag === tag ?
      { tag: item.tag, domain: domain, confidence: item.confidence, selected: selected } : item);
    this.changed();
  }

  async applySuggestions(): Promise<boolean> {
    const snapshot = this.suggestionSnapshot;
    if (!snapshot || this.suggestionBusy || this.busy || !this.same(this.taxonomy, snapshot) ||
      !this.same(this.savedTaxonomy, snapshot) || !this.suggestions.some((item: TaxonomySuggestion) => item.selected)) return false;
    const revision = ++this.suggestionRevision;
    this.suggestionBusy = true;
    this.suggestionMessage = '';
    this.suggestionError = false;
    this.changed();
    try {
      const response = await this.transport.get<TaxonomyResponse>('/taxonomy');
      if (revision !== this.suggestionRevision) return false;
      if (!this.same(response.taxonomy, snapshot) || !this.same(this.taxonomy, snapshot) ||
        !this.same(this.savedTaxonomy, snapshot)) {
        this.suggestionMessage = '分类保存版本已变化，建议未应用；请重新读取后再请求';
        this.suggestionError = true; return false;
      }
      const next = this.copy(this.taxonomy);
      const choices = this.suggestions.filter((item: TaxonomySuggestion) => item.selected);
      choices.forEach((item: TaxonomySuggestion) => next.mappings[item.tag] = item.domain);
      this.taxonomy = next;
      this.suggestions = [];
      this.suggestionSnapshot = undefined;
      this.suggestionMessage = `已应用 ${choices.length} 条建议到草稿，请点击“保存映射”`;
      return true;
    } catch (error) {
      if (revision === this.suggestionRevision) {
        this.suggestionMessage = error instanceof ApiError ? error.message : '核对分类版本失败，草稿未修改';
        this.suggestionError = true;
      }
      return false;
    } finally {
      if (revision === this.suggestionRevision) { this.suggestionBusy = false; this.changed(); }
    }
  }

  updateMapping(tag: string, domain: string): void {
    if (this.busy || this.loading) return;
    this.invalidateSuggestions();
    const next = this.copy(this.taxonomy);
    next.mappings[tag] = domain;
    this.taxonomy = next;
    this.changed();
  }

  addDomain(domain: string): void {
    const value = domain.trim();
    if (this.busy || this.loading || !value || this.taxonomy.domains.includes(value)) return;
    this.invalidateSuggestions();
    const next = this.copy(this.taxonomy);
    next.domains = next.domains.filter((item: string) => item !== '其他').concat([value, '其他']);
    this.taxonomy = next;
    this.changed();
  }

  removeDomain(domain: string): void {
    if (this.busy || this.loading || domain === '其他') return;
    this.invalidateSuggestions();
    const next = this.copy(this.taxonomy);
    next.domains = next.domains.filter((item: string) => item !== domain);
    Object.keys(next.mappings).forEach((tag: string) => {
      if (next.mappings[tag] === domain) next.mappings[tag] = '其他';
    });
    this.taxonomy = next;
    this.changed();
  }

  async load(): Promise<boolean> {
    if (this.busy) return false;
    this.invalidateSuggestions();
    const revision = ++this.revision;
    this.loading = true;
    this.loadFailed = false;
    this.errorMessage = '';
    this.changed();
    try {
      const response = await this.transport.get<TaxonomyResponse>('/taxonomy');
      if (revision !== this.revision) return false;
      this.taxonomy = this.copy(response.taxonomy);
      this.savedTaxonomy = this.copy(response.taxonomy);
      this.catalog = response.catalog;
      this.conflict = false;
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      this.errorMessage = error instanceof ApiError ? error.message : '分类数据读取失败';
      this.loadFailed = true;
      return false;
    } finally {
      if (revision === this.revision) { this.loading = false; this.changed(); }
    }
  }

  async save(): Promise<boolean> {
    if (this.busy || this.suggestionBusy || this.hasPendingSuggestions() || this.loading || this.loadFailed ||
      this.conflict || !this.hasChanges()) return false;
    const revision = ++this.revision;
    this.busy = true;
    this.errorMessage = '';
    this.changed();
    const snapshot = this.copy(this.taxonomy);
    const request: TaxonomySaveRequest = {
      domains: snapshot.domains, mappings: snapshot.mappings, baseVersion: snapshot.version
    };
    try {
      const response = await this.transport.put<TaxonomySaveResponse>('/taxonomy', request);
      if (revision !== this.revision) return false;
      this.taxonomy = this.copy(response.taxonomy);
      this.savedTaxonomy = this.copy(response.taxonomy);
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      const uncertain = !(error instanceof ApiError) || error.statusCode === 0 || error.statusCode === 409 ||
        error.statusCode >= 500 || error.code === 'INVALID_RESPONSE';
      if (uncertain) {
        try {
          const current = await this.transport.get<TaxonomyResponse>('/taxonomy');
          if (revision !== this.revision) return false;
          if (this.sameValues(current.taxonomy, snapshot)) {
            this.taxonomy = this.copy(current.taxonomy);
            this.savedTaxonomy = this.copy(current.taxonomy);
            this.catalog = current.catalog;
            this.conflict = false;
            return true;
          }
          this.conflict = current.taxonomy.version !== snapshot.version;
        } catch (_) { if (revision !== this.revision) return false; }
      }
      if (error instanceof ApiError && error.statusCode === 409) this.conflict = true;
      this.errorMessage = this.conflict ? '分类已被其他客户端修改，当前修改已保留。重新读取后再编辑。' :
        (error instanceof ApiError ? error.message : '保存映射失败，当前修改已保留');
      return false;
    } finally {
      if (revision === this.revision) { this.busy = false; this.changed(); }
    }
  }
}

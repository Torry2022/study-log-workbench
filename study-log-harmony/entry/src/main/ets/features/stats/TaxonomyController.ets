import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { Taxonomy, TaxonomyCatalogItem, TaxonomyResponse, TaxonomySaveRequest, TaxonomySaveResponse } from './TaxonomyModels';

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
  private revision: number = 0;
  private transport: ApiClient;
  private changed: () => void;

  constructor(transport: ApiClient, changed: () => void) {
    this.transport = transport;
    this.changed = changed;
  }

  dispose(): void { this.revision++; }

  private copy(source: Taxonomy): Taxonomy {
    const mappings: Record<string, string> = {};
    Object.keys(source.mappings).forEach((tag: string) => mappings[tag] = source.mappings[tag]);
    return { domains: source.domains.slice(), mappings: mappings, updatedAt: source.updatedAt, version: source.version };
  }

  hasChanges(): boolean {
    return JSON.stringify(this.taxonomy.domains) !== JSON.stringify(this.savedTaxonomy.domains) ||
      JSON.stringify(this.taxonomy.mappings) !== JSON.stringify(this.savedTaxonomy.mappings);
  }

  updateMapping(tag: string, domain: string): void {
    if (this.busy || this.loading) return;
    const next = this.copy(this.taxonomy);
    next.mappings[tag] = domain;
    this.taxonomy = next;
    this.changed();
  }

  addDomain(domain: string): void {
    const value = domain.trim();
    if (this.busy || this.loading || !value || this.taxonomy.domains.includes(value)) return;
    const next = this.copy(this.taxonomy);
    next.domains = next.domains.filter((item: string) => item !== '其他').concat([value, '其他']);
    this.taxonomy = next;
    this.changed();
  }

  removeDomain(domain: string): void {
    if (this.busy || this.loading || domain === '其他') return;
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
    if (this.busy || this.loading || this.loadFailed || this.conflict || !this.hasChanges()) return false;
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
      this.conflict = error instanceof ApiError && error.statusCode === 409;
      this.errorMessage = this.conflict ? '分类已被其他客户端修改，当前修改已保留。重新读取后再编辑。' :
        (error instanceof ApiError ? error.message : '保存映射失败，当前修改已保留');
      return false;
    } finally {
      if (revision === this.revision) { this.busy = false; this.changed(); }
    }
  }
}

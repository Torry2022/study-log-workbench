import { common } from '@kit.AbilityKit';
import { LogSearchResult } from '../features/logs/LogSearchPanel';
import { LogSearchRepository } from '../features/logs/LogSearchRepository';
import { SearchHistoryStore } from '../features/logs/SearchHistoryStore';

export interface WorkspaceSearchView {
  context: () => common.UIAbilityContext;
  lifecycle: () => number;
  namespace: () => string;
  active: () => boolean;
  open: () => boolean;
  remember: () => boolean;
  reveal: () => void;
}

@Observed
export class WorkspaceSearchController {
  searchQuery: string = '';
  searchHeadingsOnly: boolean = false;
  searchIgnoreCase: boolean = true;
  searchResults: LogSearchResult[] = [];
  searchLoading: boolean = false;
  searchError: string = '';
  searchSubmitted: boolean = false;
  searchHistory: string[] = [];
  searchActiveIndex: number = -1;
  searchRequestRevision: number = 0;
  private historyRevision: number = 0;
  private historyStore: SearchHistoryStore = new SearchHistoryStore();
  private searches: LogSearchRepository;
  private view: WorkspaceSearchView;
  constructor(searches: LogSearchRepository, view: WorkspaceSearchView) { this.searches = searches; this.view = view; }

  async searchLogs(): Promise<void> {
    if (!this.view.active()) return;
    const query = this.searchQuery.trim();
    if (!query || this.searchLoading) return;
    this.view.reveal();
    if (this.view.remember()) this.updateSearchHistory(
      [query, ...this.searchHistory.filter((item: string) => item !== query)].slice(0, 8));
    const revision = ++this.searchRequestRevision;
    const lifecycle = this.view.lifecycle();
    this.searchLoading = true;
    this.searchActiveIndex = -1;
    this.searchSubmitted = true;
    this.searchError = '';
    this.searchResults = [];
    try {
      const response = await this.searches.search(query, this.searchHeadingsOnly, this.searchIgnoreCase);
      if (revision !== this.searchRequestRevision || lifecycle !== this.view.lifecycle() || !this.view.active() || !this.view.open()) return;
      if (!Array.isArray(response.results)) throw new Error('搜索响应格式异常');
      this.searchResults = response.results;
    } catch (error) {
      if (revision === this.searchRequestRevision && lifecycle === this.view.lifecycle() && this.view.active() && this.view.open()) {
        this.searchError = error instanceof Error ? error.message : '搜索失败，请重试';
      }
    } finally {
      if (revision === this.searchRequestRevision && lifecycle === this.view.lifecycle()) this.searchLoading = false;
    }
  }

  async restoreSearchHistory(): Promise<void> {
    const revision = ++this.historyRevision;
    const lifecycle = this.view.lifecycle();
    const items = await this.historyStore.load(this.view.context(), this.view.namespace());
    if (revision === this.historyRevision && lifecycle === this.view.lifecycle() && this.view.active()) this.searchHistory = items;
  }

  updateSearchHistory(items: string[]): void {
    this.historyRevision++;
    this.searchHistory = items;
    this.searchActiveIndex = -1;
    this.historyStore.save(items);
  }

  showSearchHistory(): boolean {
    return this.view.remember() && !this.searchQuery.trim() && !this.searchSubmitted &&
      !this.searchLoading && this.searchHistory.length > 0;
  }

  dismissSearchResults(): void {
    this.searchRequestRevision++;
    this.searchLoading = false;
    this.searchActiveIndex = -1;
    this.searchResults = [];
    this.searchError = '';
    this.searchSubmitted = false;
  }

  changeLogSearchQuery(value: string, reset: boolean = false): void {
    // TextInput may echo a query selected from history; only a filter change forces invalidation.
    if (!reset && this.searchQuery === value) return;
    this.searchQuery = value;
    this.dismissSearchResults();
  }

  dispose(): void {
    this.dismissSearchResults();
    this.historyRevision++;
  }
}

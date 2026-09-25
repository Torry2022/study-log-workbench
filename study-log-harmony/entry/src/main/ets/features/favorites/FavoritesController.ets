import { ApiClient, ApiError } from '../../common/network/ApiClient';
import { FavoriteGroup, FavoriteGroupRequest, FavoriteGroupResponse, FavoriteGroupRenameRequest,
  FavoriteHeading, FavoritePayload, FavoriteGroupsUpdateRequest, FavoriteUpdateResponse } from './FavoriteModels';

interface DeleteResponse { ok: boolean; }

export interface FavoriteFilter {
  query: string;
  headingOnly: boolean;
  caseSensitive: boolean;
  sortMode: string;
}

@Observed
export class FavoritesController {
  favorites: FavoriteHeading[] = [];
  groups: FavoriteGroup[] = [];
  selectedGroup: string = 'all';
  selectedMonth: string = 'all';
  loading: boolean = false;
  loadFailed: boolean = false;
  errorMessage: string = '';
  groupError: string = '';
  groupSaving: boolean = false;
  groupActionBusy: boolean = false;
  groupUpdating: boolean = false;
  private lifetime: number = 0;
  private revision: number = 0;
  private transport: ApiClient;

  constructor(transport: ApiClient) { this.transport = transport; }

  generation(): number { return this.lifetime; }

  dispose(): void {
    this.lifetime += 1;
    this.revision += 1;
    this.loading = false;
    this.groupSaving = false;
    this.groupActionBusy = false;
    this.groupUpdating = false;
  }

  async load(): Promise<void> {
    if (this.loading) return;
    const revision = ++this.revision;
    this.loading = true;
    this.loadFailed = false;
    this.errorMessage = '';
    try {
      const response = await this.transport.get<FavoritePayload>('/favorites');
      if (revision !== this.revision) return;
      this.favorites = response.favorites;
      this.groups = response.groups;
      this.selectGroup(this.selectedGroup);
    } catch (error) {
      if (revision !== this.revision) return;
      this.errorMessage = this.message(error, '收藏读取失败');
      this.loadFailed = true;
    } finally {
      if (revision === this.revision) this.loading = false;
    }
  }

  selectGroup(id: string): void {
    if (this.selectedMonth !== 'all' && !this.groupFavorites(id).some((item: FavoriteHeading) => item.month === this.selectedMonth)) {
      this.selectedMonth = 'all';
    }
    this.selectedGroup = id;
  }

  selectMonth(month: string): void { this.selectedMonth = month; }
  resetFilters(): void { this.selectedMonth = 'all'; this.selectedGroup = 'all'; }

  groupFavorites(id: string = this.selectedGroup): FavoriteHeading[] {
    return this.favorites.filter((item: FavoriteHeading) => id === 'all' ||
      (id === 'ungrouped' ? item.groupIds.length === 0 : item.groupIds.includes(id)));
  }

  groupCount(id: string): number { return this.groupFavorites(id).length; }

  months(): string[] {
    return Array.from(new Set(this.groupFavorites().map((item: FavoriteHeading) => item.month))).sort().reverse();
  }

  filtered(filter: FavoriteFilter): FavoriteHeading[] {
    const needle = filter.caseSensitive ? filter.query.trim() : filter.query.trim().toLowerCase();
    return this.groupFavorites().filter((item: FavoriteHeading) => {
      const source = filter.headingOnly ? item.headingText : `${item.headingText}\n${item.sectionSearchText}`;
      return (this.selectedMonth === 'all' || item.month === this.selectedMonth) &&
        (!needle || (filter.caseSensitive ? source : source.toLowerCase()).includes(needle));
    }).sort((left: FavoriteHeading, right: FavoriteHeading) => filter.sortMode === 'saved_date' ?
      right.createdAt.localeCompare(left.createdAt) : right.date.localeCompare(left.date));
  }

  async remove(id: string): Promise<boolean> {
    const lifetime = this.lifetime;
    try {
      await this.transport.delete<DeleteResponse>(`/favorites?id=${encodeURIComponent(id)}`);
      if (lifetime !== this.lifetime) return false;
      this.favorites = this.favorites.filter((item: FavoriteHeading) => item.id !== id);
      return true;
    } catch (error) {
      if (lifetime === this.lifetime) this.errorMessage = this.message(error, '取消收藏失败');
      return false;
    }
  }

  async updateGroup(id: string, groupId: string, selected: boolean): Promise<boolean> {
    const favorite = this.favorites.find((item: FavoriteHeading) => item.id === id);
    if (!favorite || this.groupUpdating) return false;
    const lifetime = this.lifetime;
    this.groupUpdating = true;
    this.errorMessage = '';
    try {
      const request: FavoriteGroupsUpdateRequest = { id, groupIds: selected ? [...favorite.groupIds, groupId] :
        favorite.groupIds.filter((value: string) => value !== groupId) };
      const response = await this.transport.patch<FavoriteUpdateResponse>('/favorites', request);
      if (lifetime !== this.lifetime) return false;
      this.favorites = this.favorites.map((item: FavoriteHeading) => item.id === response.favorite.id ? response.favorite : item);
      return true;
    } catch (error) {
      if (lifetime === this.lifetime) this.errorMessage = this.message(error, '更新收藏分组失败');
      return false;
    } finally { if (lifetime === this.lifetime) this.groupUpdating = false; }
  }

  async createGroup(value: string): Promise<string> {
    const name = value.trim();
    if (!name || this.groupSaving) return '';
    const lifetime = this.lifetime;
    this.groupSaving = true;
    this.groupError = '';
    try {
      const request: FavoriteGroupRequest = { action: 'createGroup', name };
      const response = await this.transport.post<FavoriteGroupResponse>('/favorites', request);
      if (lifetime !== this.lifetime) return '';
      this.groups = [...this.groups, response.group];
      this.selectGroup(response.group.id);
      return response.group.id;
    } catch (error) {
      if (lifetime === this.lifetime) this.groupError = this.message(error, '创建收藏分组失败');
      return '';
    } finally { if (lifetime === this.lifetime) this.groupSaving = false; }
  }

  async renameGroup(id: string, value: string): Promise<boolean> {
    const name = value.trim();
    if (!name || this.groupActionBusy) return false;
    const lifetime = this.lifetime;
    this.groupActionBusy = true;
    this.groupError = '';
    try {
      const request: FavoriteGroupRenameRequest = { action: 'renameGroup', groupId: id, name };
      const response = await this.transport.patch<FavoriteGroupResponse>('/favorites', request);
      if (lifetime !== this.lifetime) return false;
      this.groups = this.groups.map((item: FavoriteGroup) => item.id === id ? response.group : item);
      return true;
    } catch (error) {
      if (lifetime === this.lifetime) this.groupError = this.message(error, '重命名收藏分组失败');
      return false;
    } finally { if (lifetime === this.lifetime) this.groupActionBusy = false; }
  }

  async deleteGroup(id: string): Promise<boolean> {
    if (this.groupActionBusy) return false;
    const lifetime = this.lifetime;
    this.groupActionBusy = true;
    this.groupError = '';
    try {
      await this.transport.delete<DeleteResponse>(`/favorites?groupId=${encodeURIComponent(id)}`);
      if (lifetime !== this.lifetime) return false;
      this.groups = this.groups.filter((item: FavoriteGroup) => item.id !== id);
      this.favorites.forEach((favorite: FavoriteHeading) => {
        favorite.groupIds = favorite.groupIds.filter((value: string) => value !== id);
      });
      this.favorites = this.favorites.slice();
      if (this.selectedGroup === id) this.selectGroup('all');
      return true;
    } catch (error) {
      if (lifetime === this.lifetime) this.groupError = this.message(error, '删除收藏分组失败');
      return false;
    } finally { if (lifetime === this.lifetime) this.groupActionBusy = false; }
  }

  private message(error: Object, fallback: string): string { return error instanceof ApiError ? error.message : fallback; }
}

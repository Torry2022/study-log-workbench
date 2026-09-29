export interface FavoriteHeading {
  id: string;
  date: string;
  month: string;
  headingText: string;
  headingId: string;
  resolvedHeadingId: string | null;
  groupIds: string[];
  sectionPreview: string;
  sectionSearchText: string;
  level: number;
  exists: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FavoriteGroup {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface FavoritePayload {
  favorites: FavoriteHeading[];
  groups: FavoriteGroup[];
}

export interface FavoriteGroupRequest {
  action: string;
  name: string;
}

export interface FavoriteGroupRenameRequest {
  action: string;
  groupId: string;
  name: string;
}

export interface FavoriteGroupResponse {
  group: FavoriteGroup;
}

export interface FavoriteGroupsUpdateRequest {
  action: string;
  id: string;
  groupId: string;
  selected: boolean;
}

export interface FavoriteUpdateResponse {
  favorite: FavoriteHeading;
}

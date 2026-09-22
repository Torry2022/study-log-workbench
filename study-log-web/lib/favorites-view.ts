import type { FavoriteHeading } from "./favorites-types.ts";

export interface FavoriteFilters {
  group: string;
  month: string;
  query: string;
  ignoreCase: boolean;
  headingsOnly: boolean;
  sort: "log-date" | "saved-date";
}
export function filterFavorites(favorites: FavoriteHeading[], filters: FavoriteFilters): FavoriteHeading[] {
  const query = filters.ignoreCase ? filters.query.trim().toLowerCase() : filters.query.trim();
  return favorites.filter(favorite => {
    if (filters.month !== "all" && favorite.month !== filters.month) return false;
    if (filters.group === "ungrouped" && favorite.groupIds.length) return false;
    if (filters.group !== "all" && filters.group !== "ungrouped" && !favorite.groupIds.includes(filters.group)) return false;
    const fields = filters.headingsOnly ? [favorite.headingText] : [favorite.headingText, favorite.sectionPreview, favorite.sectionSearchText];
    return !query || fields.some(field => (filters.ignoreCase ? field.toLowerCase() : field).includes(query));
  }).sort((a, b) => filters.sort === "saved-date"
    ? b.createdAt.localeCompare(a.createdAt)
    : b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

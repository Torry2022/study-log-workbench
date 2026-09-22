export interface FavoriteHeadingInput { date: string; headingText: string; headingId: string; level: number }
export interface FavoriteGroup { id: string; name: string; order: number; createdAt: string; updatedAt: string }
export interface FavoriteHeading extends FavoriteHeadingInput {
  id: string; month: string; resolvedHeadingId: string | null; groupIds: string[];
  sectionPreview: string; sectionSearchText: string; exists: boolean;
  createdAt: string; updatedAt: string;
}
export interface FavoritesSnapshot { favorites: FavoriteHeading[]; groups: FavoriteGroup[] }

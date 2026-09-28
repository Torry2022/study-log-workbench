export interface Taxonomy {
  domains: string[];
  mappings: Record<string, string>;
  updatedAt: string | null;
  version: string | null;
}

export interface TaxonomyCatalogItem {
  tag: string;
  count: number;
  domain: string;
  explicitlyMapped: boolean;
  sources: string[];
  months: string[];
}

export interface TaxonomyResponse { taxonomy: Taxonomy; catalog: TaxonomyCatalogItem[]; }
export interface TaxonomySaveResponse { taxonomy: Taxonomy; }
export interface TaxonomySaveRequest {
  domains: string[];
  mappings: Record<string, string>;
  baseVersion: string | null;
}

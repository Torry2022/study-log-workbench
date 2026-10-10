export interface Taxonomy {
  domains: string[];
  mappings: Record<string, string>;
  updatedAt: string | null;
  version: string | null;
}
export interface SaveTaxonomyInput { domains: string[]; mappings: Record<string, string>; baseVersion: string | null }
export interface TagCount {
  tag: string; count: number; domain: string; percentage: number; activeDays: number;
  previousCount: number; delta: number; dates: string[]; sources?: string[];
}
export interface DomainCount {
  domain: string; count: number; percentage: number; activeDays: number;
  previousCount: number; previousPercentage: number; percentagePointDelta: number;
}
export interface StatsEntry { date: string; rawHeading: string; headingText: string; headingIndex: number; tag: string; domain: string }
export interface StatsDayActivity { date: string; topicCount: number; tags: string[]; domains: string[] }
export interface MonthlyStats {
  classificationReady?: boolean;
  month: string; previousMonth: string; dayCount: number; technicalDayCount: number; topicCount: number; total: number;
  comparison: { dayCount: number; technicalDayCount: number; topicCount: number; activeDomains: number } | null;
  domainCounts: DomainCount[]; tags: TagCount[]; topTags: TagCount[]; unclassifiedTags: { tag: string; count: number }[];
  days: StatsDayActivity[]; entries: StatsEntry[];
}
export interface TaxonomyCatalogItem { tag: string; count: number; domain: string; explicitlyMapped: boolean; sources: string[]; months: string[] }

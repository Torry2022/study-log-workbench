export interface StatsComparison {
  dayCount: number;
  technicalDayCount: number;
  topicCount: number;
  activeDomains: number;
}

export interface DomainCount {
  domain: string;
  count: number;
  percentage: number;
  activeDays: number;
  previousCount: number;
  previousPercentage: number;
  percentagePointDelta: number;
}

export interface TagCount {
  tag: string;
  count: number;
  domain: string;
  percentage: number;
  activeDays: number;
  previousCount: number;
  delta: number;
  dates: string[];
  sources?: string[];
}

export interface StatsDayActivity { date: string; topicCount: number; tags: string[]; domains: string[]; }
export interface StatsEntry {
  date: string;
  rawHeading: string;
  headingText: string;
  headingIndex: number;
  tag: string;
  domain: string;
}

export interface UnclassifiedTag { tag: string; count: number; }

export interface MonthlyStats {
  classificationReady?: boolean;
  month: string;
  previousMonth: string;
  dayCount: number;
  technicalDayCount: number;
  topicCount: number;
  total: number;
  comparison: StatsComparison | null;
  domainCounts: DomainCount[];
  tags: TagCount[];
  topTags: TagCount[];
  unclassifiedTags: UnclassifiedTag[];
  days: StatsDayActivity[];
  entries: StatsEntry[];
}

export interface StatsResponse { stats: MonthlyStats; }

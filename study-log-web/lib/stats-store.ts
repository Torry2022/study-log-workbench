import { listMonths, listSavedDayContents } from "./log-store.ts";
import { findRootAtxHeadings } from "./day-content.ts";
import { todayInShanghai } from "./study-date.ts";
import { readTaxonomy, TaxonomyInputError } from "./taxonomy-store.ts";
import { headingTextOf, normalizeHeading, taxonomyMapping } from "./stats-tags.ts";
import type { MonthlyStats, StatsEntry, Taxonomy, TaxonomyCatalogItem } from "./stats-types.ts";

const OTHER_DOMAIN = "其他";
interface ParsedHeading extends StatsEntry { month: string }
export interface ParsedDay { date: string; month: string; headings: ParsedHeading[] }
export function assertMonth(month: string): void {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new TaxonomyInputError("月份无效，请使用YYYY-MM");
}
export function parseStatsDays(blocks: ReadonlyArray<{ date: string; content: string }>): ParsedDay[] {
  return blocks.map(block => ({ date: block.date, month: block.date.slice(0, 7),
    headings: findRootAtxHeadings(block.content, 3).map((heading, headingIndex) => ({
      date: block.date, month: block.date.slice(0, 7), rawHeading: heading.text,
      headingText: headingTextOf(heading.text), headingIndex, tag: normalizeHeading(heading.text), domain: OTHER_DOMAIN
    })).filter(heading => heading.tag)
  }));
}
async function readAllParsedDays(): Promise<ParsedDay[]> { return parseStatsDays(await listSavedDayContents()); }
function resolveTagDomain(tag: string, taxonomy: Taxonomy, validDomains: Set<string>): string {
  const domain = taxonomyMapping(taxonomy.mappings, tag) ?? OTHER_DOMAIN;
  return validDomains.has(domain) ? domain : OTHER_DOMAIN;
}
function previousMonthOf(month: string): string {
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  return number === 1 ? `${String(year - 1).padStart(4, "0")}-12` : `${month.slice(0, 4)}-${String(number - 1).padStart(2, "0")}`;
}

interface MonthAggregate {
  days: ParsedDay[];
  entries: StatsEntry[];
  tagCounts: Map<string, number>;
  tagDays: Map<string, Set<string>>;
  tagSources: Map<string, Set<string>>;
  domainCounts: Map<string, number>;
  domainDays: Map<string, Set<string>>;
}

function aggregateMonth(days: ParsedDay[], month: string, taxonomy: Taxonomy): MonthAggregate {
  const monthDays = days.filter((day) => day.month === month).sort((a, b) => a.date.localeCompare(b.date));
  const validDomains = new Set(taxonomy.domains);
  const tagCounts = new Map<string, number>();
  const tagDays = new Map<string, Set<string>>();
  const tagSources = new Map<string, Set<string>>();
  const domainCounts = new Map<string, number>();
  const domainDays = new Map<string, Set<string>>();
  const entries: StatsEntry[] = [];

  for (const day of monthDays) {
    for (const heading of day.headings) {
      const domain = resolveTagDomain(heading.tag, taxonomy, validDomains);
      tagCounts.set(heading.tag, (tagCounts.get(heading.tag) || 0) + 1);
      const dates = tagDays.get(heading.tag) || new Set<string>();
      dates.add(day.date);
      tagDays.set(heading.tag, dates);
      const sources = tagSources.get(heading.tag) || new Set<string>();
      sources.add(heading.rawHeading);
      tagSources.set(heading.tag, sources);
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      const domainDates = domainDays.get(domain) || new Set<string>();
      domainDates.add(day.date);
      domainDays.set(domain, domainDates);
      entries.push({
        date: day.date,
        rawHeading: heading.rawHeading,
        headingText: heading.headingText,
        headingIndex: heading.headingIndex,
        tag: heading.tag,
        domain
      });
    }
  }

  return { days: monthDays, entries, tagCounts, tagDays, tagSources, domainCounts, domainDays };
}

function roundedPercentage(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

export async function getMonthlyStats(month: string): Promise<MonthlyStats> {
  assertMonth(month);
  const [taxonomy, days] = await Promise.all([readTaxonomy(), readAllParsedDays()]);
  return calculateMonthlyStats(days, month, taxonomy);
}

export function calculateMonthlyStats(days: ParsedDay[], month: string, taxonomy: Taxonomy): MonthlyStats {
  assertMonth(month);
  const previousMonth = previousMonthOf(month);
  const current = aggregateMonth(days, month, taxonomy);
  const previous = aggregateMonth(days, previousMonth, taxonomy);
  const topicCount = current.entries.length;
  const previousTopicCount = previous.entries.length;
  const hasPreviousData = previous.days.length > 0;
  const validDomains = new Set(taxonomy.domains);

  const unclassifiedTags = [...current.tagCounts.entries()]
    .filter(([tag]) => taxonomyMapping(taxonomy.mappings, tag) === undefined)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));

  const tagItems = [...current.tagCounts.entries()]
    .map(([tag, count]) => {
      const previousCount = previous.tagCounts.get(tag) || 0;
      return {
        tag,
        count,
        domain: resolveTagDomain(tag, taxonomy, validDomains),
        percentage: roundedPercentage(count, topicCount),
        activeDays: current.tagDays.get(tag)?.size || 0,
        previousCount,
        delta: count - previousCount,
        dates: [...(current.tagDays.get(tag) || new Set<string>())].sort(),
        sources: [...(current.tagSources.get(tag) || new Set<string>())].sort((a, b) => a.localeCompare(b, "zh-CN")).slice(0, 6)
      };
    })
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));

  const domainCounts = [...current.domainCounts.entries()]
    .map(([domain, count]) => {
      const previousCount = previous.domainCounts.get(domain) || 0;
      const percentage = roundedPercentage(count, topicCount);
      const previousPercentage = roundedPercentage(previousCount, previousTopicCount);
      return {
        domain,
        count,
        percentage,
        activeDays: current.domainDays.get(domain)?.size || 0,
        previousCount,
        previousPercentage,
        percentagePointDelta: Math.round((percentage - previousPercentage) * 10) / 10
      };
    })
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain, "zh-CN"));

  return {
    classificationReady: taxonomy.domains.some(domain => domain !== OTHER_DOMAIN) || Object.keys(taxonomy.mappings).length > 0,
    month,
    previousMonth,
    dayCount: current.days.length,
    technicalDayCount: current.days.filter((day) => day.headings.length > 0).length,
    topicCount,
    total: topicCount,
    comparison: hasPreviousData
      ? {
          dayCount: previous.days.length,
          technicalDayCount: previous.days.filter((day) => day.headings.length > 0).length,
          topicCount: previousTopicCount,
          activeDomains: [...previous.domainCounts.keys()].filter((domain) => domain !== OTHER_DOMAIN).length
        }
      : null,
    domainCounts,
    tags: tagItems,
    topTags: tagItems.slice(0, 10),
    unclassifiedTags,
    days: current.days.map((day) => ({
      date: day.date,
      topicCount: day.headings.length,
      tags: [...new Set(day.headings.map((heading) => heading.tag))],
      domains: [...new Set(day.headings.map((heading) => resolveTagDomain(heading.tag, taxonomy, validDomains)))]
    })),
    entries: current.entries
  };
}

export async function getTaxonomyCatalog(): Promise<TaxonomyCatalogItem[]> {
  const [taxonomy, days] = await Promise.all([readTaxonomy(), readAllParsedDays()]);
  return calculateTaxonomyCatalog(days, taxonomy);
}

export function calculateTaxonomyCatalog(days: ParsedDay[], taxonomy: Taxonomy): TaxonomyCatalogItem[] {
  const validDomains = new Set(taxonomy.domains);
  const counts = new Map<string, number>();
  const sources = new Map<string, Set<string>>();
  const months = new Map<string, Set<string>>();

  for (const day of days) {
    for (const heading of day.headings) {
      counts.set(heading.tag, (counts.get(heading.tag) || 0) + 1);
      const tagSources = sources.get(heading.tag) || new Set<string>();
      tagSources.add(heading.rawHeading);
      sources.set(heading.tag, tagSources);
      const tagMonths = months.get(heading.tag) || new Set<string>();
      tagMonths.add(day.month);
      months.set(heading.tag, tagMonths);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      domain: resolveTagDomain(tag, taxonomy, validDomains),
      explicitlyMapped: taxonomyMapping(taxonomy.mappings, tag) !== undefined,
      sources: [...(sources.get(tag) || new Set<string>())].sort((a, b) => a.localeCompare(b, "zh-CN")).slice(0, 8),
      months: [...(months.get(tag) || new Set<string>())].sort((a, b) => b.localeCompare(a))
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

export async function getDefaultStatsMonth(): Promise<string> {
  const months = await listMonths();
  return months[0]?.id || todayInShanghai().slice(0, 7);
}

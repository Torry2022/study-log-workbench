import { isValidLogDate, todayInShanghai } from "./study-date.ts";
import type { RagRetrievalStrategy } from "./rag-types.ts";

export interface RagRetrievalPlan {
  dateFrom?: string;
  dateTo?: string;
  strategy: RagRetrievalStrategy;
  matchMode?: "literal";
  literalQuery?: string;
  maxChunks?: number;
  maxChars?: number;
}

const RETRIEVAL_STRATEGIES = new Set<RagRetrievalPlan["strategy"]>([
  "relevance",
  "timeline_summary",
  "comparison"
]);

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function parseDayCount(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100 };
  let total = 0;
  let digit = 0;
  for (const character of value) {
    if (character in digits) {
      digit = digits[character];
    } else if (character in units) {
      total += (digit || 1) * units[character];
      digit = 0;
    } else {
      return null;
    }
  }
  return total + digit || null;
}

function monthRange(year: number, month: number): Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> {
  return {
    dateFrom: toIsoDate(utcDate(year, month, 1)),
    dateTo: toIsoDate(new Date(Date.UTC(year, month, 0)))
  };
}

function chinaToday(now: Date): Date {
  return new Date(`${todayInShanghai(now)}T00:00:00Z`);
}

export function chinaTodayIso(now = new Date()): string {
  return toIsoDate(chinaToday(now));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && isValidLogDate(value);
}

function explicitDate(year: number, month: number, day: number): string | null {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidLogDate(value) ? value : null;
}

function withStrategyLimits(
  strategy: RagRetrievalPlan["strategy"],
  range: Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> = {}
): RagRetrievalPlan {
  if (strategy === "timeline_summary") return { ...range, strategy, maxChunks: 20, maxChars: 30000 };
  if (strategy === "comparison") return { ...range, strategy, maxChunks: 12, maxChars: 18000 };
  return { ...range, strategy };
}

export function normalizeSemanticRetrievalPlan(value: unknown): RagRetrievalPlan | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const strategy = candidate.strategy;
  if (typeof strategy !== "string" || !RETRIEVAL_STRATEGIES.has(strategy as RagRetrievalPlan["strategy"])) {
    return null;
  }

  const hasDateFrom = candidate.dateFrom !== null && candidate.dateFrom !== undefined;
  const hasDateTo = candidate.dateTo !== null && candidate.dateTo !== undefined;
  if (hasDateFrom !== hasDateTo) return null;

  const range: Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> = {};
  if (hasDateFrom && hasDateTo) {
    if (!isIsoDate(candidate.dateFrom) || !isIsoDate(candidate.dateTo)) return null;
    range.dateFrom = candidate.dateFrom;
    range.dateTo = candidate.dateTo;
    if (range.dateFrom > range.dateTo) {
      [range.dateFrom, range.dateTo] = [range.dateTo, range.dateFrom];
    }
  }

  return withStrategyLimits(strategy as RagRetrievalPlan["strategy"], range);
}

export function needsSemanticRetrievalPlanning(plan: RagRetrievalPlan): boolean {
  return !plan.matchMode && !plan.dateFrom && !plan.dateTo && plan.strategy === "relevance";
}

function extractLiteralLookup(value: string): string | null {
  const hasLookupIntent =
    /(?:原文|哪天|什么时候|哪篇日志|哪个(?:日块|日志)|在哪(?:天|篇|个日块|个日志)?|哪里).{0,16}(?:写过|写了|提到过|提过|提到|记录过|记录了|记过|出现过|出现于|包含)|(?:搜索|查找|定位)(?:一下|原文|日志)?/.test(value);
  if (!hasLookupIntent) return null;

  const quoted = value.match(/`([^`\n]{1,120})`|“([^”\n]{1,120})”|‘([^’\n]{1,120})’|"([^"\n]{1,120})"|'([^'\n]{1,120})'/);
  const quotedValue = quoted?.slice(1).find(Boolean)?.trim();
  if (quotedValue) return quotedValue;

  const trailing = value.match(/(?:写过|写了|提到过|提过|提到|记录过|记录了|记过|出现过|出现于|包含|搜索|查找|定位)(?:一下|原文|日志)?\s*(?:关于)?\s*(.+?)[？?。！!]*$/);
  const candidate = trailing?.[1]?.trim();
  if (!candidate || candidate.length > 120) return null;
  return candidate;
}

function explicitDateRange(value: string): Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> | null {
  const namedDays = [...value.matchAll(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/g)];
  for (let start = 0; start < namedDays.length - 2; start++) {
    const connected = [namedDays[start]];
    for (let next = start + 1; next < namedDays.length; next++) {
      const previous = connected[connected.length - 1];
      const separator = value.slice((previous.index ?? 0) + previous[0].length, namedDays[next].index ?? 0);
      if (!/^\s*(?:至|到|与|和|及|、|~|—|-)\s*$/.test(separator)) break;
      connected.push(namedDays[next]);
    }
    if (connected.length >= 3) {
      const dates = connected.map(day => explicitDate(Number(day[1]), Number(day[2]), Number(day[3])));
      if (dates.some(date => !date)) return {};
      const ordered = (dates as string[]).sort();
      return { dateFrom: ordered[0], dateTo: ordered[ordered.length - 1] };
    }
  }
  const match = value.match(
    /(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?\s*(?:至|到|与|和|及|、|~|—|-)\s*(?:(20\d{2})[-年/])?(?:(\d{1,2})[-月/])?(\d{1,2})日?/
  );
  if (!match) return null;
  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const dateFrom = explicitDate(startYear, startMonth, Number(match[3]));
  const dateTo = explicitDate(match[4] === undefined ? startYear : Number(match[4]), match[5] === undefined ? startMonth : Number(match[5]), Number(match[6]));
  // A recognized but invalid range must not fall back to its first day or month.
  return dateFrom && dateTo ? { dateFrom, dateTo } : {};
}

export function planRagRetrieval(query: string, now = new Date()): RagRetrievalPlan {
  const value = query.normalize("NFKC");
  const literalQuery = extractLiteralLookup(query);
  if (literalQuery) {
    return {
      strategy: "relevance",
      matchMode: "literal",
      literalQuery
    };
  }
  const today = chinaToday(now);
  let range: Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> = {};

  const explicitRange = explicitDateRange(value);
  const explicitDay = value.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
  const explicitMonth = value.match(/(20\d{2})[-年/](\d{1,2})月?/);
  const recentDays = value.match(/(?:最近|近|过去)\s*([0-9零一二两三四五六七八九十百]+)\s*天/);

  if (explicitRange) {
    range = explicitRange;
  } else if (explicitDay) {
    const date = explicitDate(Number(explicitDay[1]), Number(explicitDay[2]), Number(explicitDay[3]));
    if (date) range = { dateFrom: date, dateTo: date };
  } else if (explicitMonth) {
    const month = Number(explicitMonth[2]);
    if (month >= 1 && month <= 12) range = monthRange(Number(explicitMonth[1]), month);
  } else if (recentDays || value.includes("最近")) {
    const days = Math.min(Math.max(parseDayCount(recentDays?.[1] || "") || 7, 1), 366);
    range = { dateFrom: toIsoDate(shiftDays(today, -(days - 1))), dateTo: toIsoDate(today) };
  } else if (/本月|这个月/.test(value)) {
    range = monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1);
  } else if (/上月|上个月/.test(value)) {
    const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    range = monthRange(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1);
  } else if (/今年|本年度/.test(value)) {
    range = {
      dateFrom: `${today.getUTCFullYear()}-01-01`,
      dateTo: `${today.getUTCFullYear()}-12-31`
    };
  }

  if (range.dateFrom && range.dateTo && range.dateFrom > range.dateTo) {
    [range.dateFrom, range.dateTo] = [range.dateTo, range.dateFrom];
  }
  const comparison = /(?:对比|比较|区别|异同|差异|\bvs\.?\b)/i.test(value);
  const timelineSummary =
    Boolean(range.dateFrom || range.dateTo) && /(?:学了什么|学了哪些|学习内容|主要学习|总结|回顾|概览|大致学)/.test(value);
  if (timelineSummary) return withStrategyLimits("timeline_summary", range);
  if (comparison) {
    return withStrategyLimits("comparison", range);
  }
  return withStrategyLimits("relevance", range);
}

import { isValidLogDate, todayInShanghai } from "./study-date.ts";
import type { RagRetrievalStrategy } from "./rag-types.ts";

export interface RagRetrievalPlan {
  invalidDate?: boolean;
  ranges?: Array<{ dateFrom: string; dateTo: string }>;
  eventDates?: boolean;
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
  return !plan.eventDates && !plan.matchMode && !plan.dateFrom && !plan.dateTo && plan.strategy === "relevance";
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
  // Event dates describe the subject, not when the user wrote a log.
  // Only discard an explicit rejected operation followed by a replacement request.
  // Negation inside a topic (e.g. “为什么不能重试”) is still searchable content.
  const activeText = query.replace(/^(?:不用|不要|无需)比较[^，,；;。]+[，,；;。]\s*(?=只(?:总结|回顾|查找|搜索))/, "");
  const literalQuery = extractLiteralLookup(activeText);
  // Quoted lookup text is content, not an independent calendar constraint.
  const active = (literalQuery ? activeText.replace(/`[^`\n]+`|“[^”\n]+”|‘[^’\n]+’|"[^"\n]+"|'[^'\n]+'/g, "") : activeText).normalize("NFKC");
  const withoutEvents = active.replace(/(?:20\d{2}[-/]\d{1,2}(?:[-/]\d{1,2})?|(?:(?:20\d{2}年|前年|去年|今年|本年度|明年|后年)[ \t]*(?:的[ \t]*)?)?(?:[一二三四五六七八九十]+|\d{1,2})月(?:(?:[一二三四五六七八九十]+|\d{1,2})日)?|(?:20\d{2}年|前年|去年|今年|本年度|明年|后年)[ \t]*(?:的[ \t]*)?)(?=\s*(?:正式|首次)?(?:发布|推出|发生|上线|举办|版本))/g, "");
  const today = chinaToday(now);
  const relativeYears: Record<string, number> = { 前年: -2, 去年: -1, 今年: 0, 本年度: 0, 明年: 1, 后年: 2 };
  // Expand only a year qualifier attached to a month; event dates were removed first.
  const calendar = withoutEvents.replace(/(前年|去年|今年|本年度|明年|后年)[ \t]*(?:的[ \t]*)?(?=[一二三四五六七八九十\d]+月)/g,
    (_full, label: string) => `${today.getUTCFullYear() + relativeYears[label]}年`);
  // Resolve calendar months in code, including an omitted year in “九月和十月”.
  const replacedYears = [...new Set([...query.slice(0, query.length - activeText.length).matchAll(/(20\d{2})年/g)].map(match => match[1]))];
  let year = Number(calendar.match(/(20\d{2})年/)?.[1] || (replacedYears.length === 1 ? replacedYears[0] : undefined) || today.getUTCFullYear());
  // Enumerations inherit the named month: “10月1日、2日和3日”.
  // Require 日 on abbreviated items so ordinary numbers are not treated as dates.
  const expandedDays = calendar.replace(/((20\d{2})年(\d{1,2})月\d{1,2}日)((?:\s*(?:、|和|与|及|至|到|~|—|-)\s*\d{1,2}日)+)/g,
    (_full, first, namedYear, month, rest: string) => first + rest.replace(/\d{1,2}日/g, day => `${namedYear}年${month}月${day}`));
  const value = expandedDays.replace(/(?:(20\d{2})年)?([一二三四五六七八九十]+|\d{1,2})月(?!\d|[一二三四五六七八九十]+日)/g, (full, namedYear, monthText) => {
    const month = parseDayCount(monthText);
    if (!month || month > 12) return full;
    if (namedYear) year = Number(namedYear);
    return `${year}年${month}月`;
  });
  let range: Pick<RagRetrievalPlan, "dateFrom" | "dateTo"> = {};
  let invalidDate = false;

  const explicitRange = explicitDateRange(value);
  const explicitDay = value.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
  const explicitMonth = value.match(/(20\d{2})[-年/](\d{1,2})月?/);
  const recentDays = value.match(/(?:最近|近|过去)\s*([0-9零一二两三四五六七八九十百]+)\s*天/);

  if (explicitRange) {
    range = explicitRange;
    invalidDate = !range.dateFrom;
  } else if (explicitDay) {
    const date = explicitDate(Number(explicitDay[1]), Number(explicitDay[2]), Number(explicitDay[3]));
    if (date) range = { dateFrom: date, dateTo: date };
    else invalidDate = true;
  } else if (explicitMonth) {
    const month = Number(explicitMonth[2]);
    if (month >= 1 && month <= 12) range = monthRange(Number(explicitMonth[1]), month);
    else invalidDate = true;
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
  const comparison = /(?:对比|比较|区分|区别|异同|差异|\bvs\.?\b)/i.test(value);
  const timelineSummary =
    Boolean(range.dateFrom || range.dateTo) && /(?:学了什么|学了哪些|学习内容|主要学习|总结|回顾|概览|大致学|分别.{0,8}(?:什么|哪些))/.test(value);
  const strategy = literalQuery ? "relevance" : comparison ? "comparison" : timelineSummary ? "timeline_summary" : "relevance";
  const plan = withStrategyLimits(strategy, range);
  if (invalidDate) plan.invalidDate = true;
  if (literalQuery) Object.assign(plan, { matchMode: "literal", literalQuery });
  if (withoutEvents !== active) plan.eventDates = true;
  // Separate explicit scopes must not silently include days between them.
  const scopes = [...value.matchAll(/(20\d{2})[-年/](\d{1,2})(?:[-月/](\d{1,2})日?|月)?(?!\d)/g)];
  const groupedRanges = (matches: RegExpMatchArray[], ranges: Array<{ dateFrom: string; dateTo: string }>) => {
    const groups: typeof ranges = [];
    ranges.forEach((range, index) => {
      const previous = matches[index - 1];
      const connector = previous ? value.slice(previous.index! + previous[0].length, matches[index].index) : "";
      if (previous && /^\s*(?:至|到|~|—|-)\s*$/.test(connector)) {
        const group = groups[groups.length - 1];
        group.dateFrom = [group.dateFrom, range.dateFrom].sort()[0];
        group.dateTo = [group.dateTo, range.dateTo].sort().at(-1)!;
      } else groups.push({ ...range });
    });
    return groups.filter((range, index) => groups.findIndex(other => other.dateFrom === range.dateFrom && other.dateTo === range.dateTo) === index);
  };
  if (scopes.length > 1) {
    const ranges = scopes.map(scope => {
      const year = Number(scope[1]), month = Number(scope[2]);
      if (scope[3] !== undefined) {
        const date = explicitDate(year, month, Number(scope[3]));
        return date ? { dateFrom: date, dateTo: date } : null;
      }
      return month >= 1 && month <= 12 ? monthRange(year, month) : null;
    });
    if (ranges.every(Boolean)) plan.ranges = groupedRanges(scopes, ranges as Array<{ dateFrom: string; dateTo: string }>).sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
    else plan.invalidDate = true;
  }
  if (plan.ranges?.length) {
    plan.dateFrom = plan.ranges.map(item => item.dateFrom).sort()[0];
    plan.dateTo = plan.ranges.map(item => item.dateTo).sort().at(-1);
    if (!literalQuery && plan.strategy === "relevance" && plan.ranges.length > 1 && /变化|改变|不同/.test(value)) {
      Object.assign(plan, withStrategyLimits("comparison"));
    }
  }
  return plan;
}

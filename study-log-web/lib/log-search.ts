import { listSavedDayContents } from "./log-store.ts";
import { findRootAtxHeadings } from "./day-content.ts";

export interface SearchResult {
  date: string;
  month: string;
  fileName: string;
  headings: string[];
  matches: string[];
}

export interface LogSearchOptions { ignoreCase?: boolean; headingsOnly?: boolean }
interface SearchDay { date: string; content: string; fileName: string }

/** Literal, line-based search; full text deliberately includes code examples. */
export function searchDayContents(blocks: readonly SearchDay[], query: string, options: LogSearchOptions = {}): SearchResult[] {
  const normalize = options.ignoreCase === false ? (value: string) => value : (value: string) => value.toLowerCase();
  const needle = normalize(query.trim());
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const headings = findRootAtxHeadings(block.content, 3);
    const headingLines = new Set(headings.map(heading => heading.line));
    const matches = block.content.split(/\r?\n/)
      .filter((line, index) => (!options.headingsOnly || headingLines.has(index + 1)) && normalize(line).includes(needle))
      .slice(0, 5).map(line => line.trim());
    if (!matches.length) continue;
    results.push({ date: block.date, month: block.date.slice(0, 7), fileName: block.fileName,
      headings: headings.map(heading => heading.text.replace(/^\d+\.\s+/, "").trim()), matches });
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export async function searchLogs(query: string, options: LogSearchOptions = {}): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  return searchDayContents(await listSavedDayContents(), query, options);
}

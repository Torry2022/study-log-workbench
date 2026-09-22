import { unified } from "unified";
import remarkParse from "remark-parse";

const markdownParser = unified().use(remarkParse);

export const INVALID_DAY_CONTENT_ERROR_CODE = "invalid_day_content";

export interface MarkdownRootHeading {
  text: string;
  start: number;
  end: number;
}

export class InvalidDayContentError extends Error {
  readonly code = INVALID_DAY_CONTENT_ERROR_CODE;

  constructor(message = "当前日块正文不能包含二级标题；日期标题由系统维护，请改用三级标题") {
    super(message);
    this.name = "InvalidDayContentError";
  }
}

export function stripTrailingStructuralSeparator(markdown: string): string {
  const trimmed = markdown.trimEnd();
  if (/^[ \t]*---[ \t]*$/.test(trimmed)) return "";
  return trimmed.replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, "").trimEnd();
}

export function findRootAtxHeadings(markdown: string, depth: 2 | 3): MarkdownRootHeading[] {
  const headings: MarkdownRootHeading[] = [];
  // Root headings describe days/sections; code, lists and quotes do not.
  for (const node of markdownParser.parse(markdown).children) {
    if (node.type !== "heading" || node.depth !== depth || !node.position) continue;
    const offset = node.position.start.offset;
    const end = node.position.end.offset;
    if (offset === undefined || end === undefined) continue;
    const start = offset === 0 ? 0 : markdown.lastIndexOf("\n", offset - 1) + 1;
    const line = markdown.slice(start, end);
    const headingMatch = line.match(/^ {0,3}(#{2,3})(?!#)[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (!headingMatch || headingMatch[1].length !== depth) continue;
    headings.push({
      text: headingMatch[2].trim(),
      start,
      end: start + line.length
    });
  }

  return headings;
}

export function findLevelTwoHeadings(markdown: string): MarkdownRootHeading[] {
  return findRootAtxHeadings(markdown, 2);
}

export function assertEditableDayBody(content: string): void {
  if (findLevelTwoHeadings(content).length > 0) {
    throw new InvalidDayContentError();
  }
}

export function toEditableDayBody(date: string, content: string): string {
  const trimmed = stripTrailingStructuralSeparator(content);
  const heading = findLevelTwoHeadings(trimmed)[0];
  if (!heading || heading.start !== 0 || heading.text !== date) return trimmed;
  return trimmed.slice(heading.end).replace(/^\r?\n+/, "").trimEnd();
}

export function normalizeDayContent(date: string, content: string): string {
  const trimmed = stripTrailingStructuralSeparator(content.trim());
  if (!trimmed) return `## ${date}\n\n`;

  const headings = findLevelTwoHeadings(trimmed);
  let body = trimmed;
  if (headings[0]?.start === 0) {
    const firstHeading = headings[0];
    if (firstHeading.text !== date) {
      throw new InvalidDayContentError("日块顶部日期与当前选择的日期不一致");
    }
    body = trimmed.slice(firstHeading.end).replace(/^\r?\n+/, "").trim();
  }

  assertEditableDayBody(body);
  return body ? `## ${date}\n\n${body}` : `## ${date}\n\n`;
}

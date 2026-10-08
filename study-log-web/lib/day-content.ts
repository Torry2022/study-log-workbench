import { unified } from "unified";
import remarkParse from "remark-parse";

const markdownParser = unified().use(remarkParse);

export const INVALID_DAY_CONTENT_ERROR_CODE = "invalid_day_content";

export interface MarkdownRootHeading {
  text: string;
  level: number;
  line: number;
  start: number;
  end: number;
}

export class InvalidDayContentError extends Error {
  readonly code = INVALID_DAY_CONTENT_ERROR_CODE;

  constructor(message = "当前日志正文不能包含二级标题；日期标题由系统维护，请改用三级标题") {
    super(message);
    this.name = "InvalidDayContentError";
  }
}

export function stripTrailingStructuralSeparator(markdown: string): string {
  const trimmed = markdown.trimEnd();
  const last = markdownParser.parse(trimmed).children.at(-1);
  const start = last?.position?.start.offset;
  if (last?.type === "thematicBreak" && start !== undefined && /^[ \t]*---[ \t]*$/.test(trimmed.slice(start))) {
    return trimmed.slice(0, start).trimEnd();
  }
  return trimmed;
}

export function findRootAtxHeadings(markdown: string, depth?: 2 | 3 | 4 | 5 | 6): MarkdownRootHeading[] {
  const headings: MarkdownRootHeading[] = [];
  // Root headings describe days/sections; code, lists and quotes do not.
  for (const node of markdownParser.parse(markdown).children) {
    if (node.type !== "heading" || node.depth < 2 || (depth && node.depth !== depth) || !node.position) continue;
    const offset = node.position.start.offset;
    const end = node.position.end.offset;
    if (offset === undefined || end === undefined) continue;
    const start = offset === 0 ? 0 : markdown.lastIndexOf("\n", offset - 1) + 1;
    const line = markdown.slice(start, end);
    const headingMatch = line.match(/^ {0,3}(#{2,6})(?!#)[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (!headingMatch) continue;
    headings.push({
      text: headingMatch[2].trim(),
      level: node.depth,
      line: node.position.start.line,
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
  // Parse both ATX and Setext syntax; nested examples are not day structure.
  for (const node of markdownParser.parse(content).children) {
    if (node.type !== "heading") continue;
    if (node.depth === 1) {
      throw new InvalidDayContentError("日志正文不能使用一级标题，请改用三级至六级标题");
    }
    if (node.depth === 2) throw new InvalidDayContentError();
  }
}

export function toEditableDayBody(date: string, content: string): string {
  const trimmed = stripTrailingStructuralSeparator(content);
  const heading = findLevelTwoHeadings(trimmed)[0];
  if (!heading || heading.start !== 0 || heading.text !== date) return trimmed;
  return trimmed.slice(heading.end).replace(/^\r?\n+/, "").trimEnd();
}

export function normalizeDayContent(date: string, content: string): string {
  const trimmed = stripTrailingStructuralSeparator(content.replace(/^(?:[ \t]*\r?\n)+/, ""));
  if (!trimmed) return `## ${date}\n\n`;

  const headings = findLevelTwoHeadings(trimmed);
  let body = trimmed;
  if (headings[0]?.start === 0) {
    const firstHeading = headings[0];
    if (firstHeading.text !== date) {
      throw new InvalidDayContentError("日志顶部日期与当前选择的日期不一致");
    }
    body = trimmed.slice(firstHeading.end).replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
  }

  assertEditableDayBody(body);
  return body ? `## ${date}\n\n${body}` : `## ${date}\n\n`;
}

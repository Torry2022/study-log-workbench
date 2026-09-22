import { unified } from "unified";
import remarkParse from "remark-parse";
import { SourceError } from "./paths.mjs";

const parser = unified().use(remarkParse);
export const LOG_FILE_PATTERN = /^(\d{4})(?:-(0[1-9]|1[0-2]))?_学习日志\.md$/;
export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function assertDate(value) {
  if (!isValidDate(value)) throw new SourceError("Invalid date. Expected a valid YYYY-MM-DD calendar date.", "INVALID_ARGUMENT");
}
export function assertMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new SourceError("Invalid month. Expected YYYY-MM.", "INVALID_ARGUMENT");
}
export function rootHeadings(content, level) {
  return parser.parse(content).children.flatMap(node => {
    if (node.type !== "heading" || (level && node.depth !== level) || !node.position) return [];
    const start = node.position.start.offset, end = node.position.end.offset;
    const raw = content.slice(start, end);
    const match = raw.match(/^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (!match) return [];
    const lineStart = start === 0 ? 0 : content.lastIndexOf("\n", start - 1) + 1;
    return [{ level: node.depth, text: match[2].trim(), start: lineStart, end }];
  });
}
export function stripStructuralSeparator(content) {
  const last = parser.parse(content).children.at(-1);
  if (last?.type === "thematicBreak" && /^ {0,3}---[ \t]*$/.test(content.slice(last.position.start.offset, last.position.end.offset))) {
    return content.slice(0, last.position.start.offset).trimEnd();
  }
  return content.trimEnd();
}
export function plainInline(value) {
  return String(value || "").replace(/!\[([^\]]*)]\([^)]+\)/g, "$1").replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1").replace(/<\/?[^>]+>/g, "").replace(/[*_~]/g, "").replace(/\s+/g, " ").trim();
}
export function getHeadings(content) {
  return rootHeadings(content, 3).map(heading => plainInline(heading.text).replace(/^\d+\.\s*/, "").trim()).filter(Boolean);
}
export function getPreview(content, maxLength = 180) {
  const parts = [];
  function visit(node) {
    if (["heading", "code", "image", "definition", "html"].includes(node.type)) return;
    if (node.type === "text" || node.type === "inlineCode") parts.push(node.value);
    else node.children?.forEach(visit);
  }
  visit(parser.parse(content));
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
export function parseDayBlocks(content, fileName) {
  const source = fileName.match(LOG_FILE_PATTERN);
  if (!source) throw new SourceError("Unsupported log filename.");
  const headings = rootHeadings(content, 2).filter(heading => /^\d{4}-\d{2}-\d{2}$/.test(heading.text));
  return headings.map((heading, index) => {
    if (!isValidDate(heading.text)) throw new SourceError("Source contains an invalid calendar date.");
    const prefix = source[2] ? `${source[1]}-${source[2]}-` : `${source[1]}-`;
    if (!heading.text.startsWith(prefix)) throw new SourceError("Day date does not match its source filename.");
    const dayContent = stripStructuralSeparator(content.slice(heading.start, headings[index + 1]?.start ?? content.length));
    return { date: heading.text, month: heading.text.slice(0, 7), fileName, content: dayContent, headings: getHeadings(dayContent), preview: getPreview(dayContent) };
  });
}
export function parseSections(block) {
  const headings = rootHeadings(block.content, 3), sections = [];
  let preamble = block.content.slice(0, headings[0]?.start ?? block.content.length);
  const day = rootHeadings(preamble, 2)[0];
  if (day?.start === 0 && day.text === block.date) preamble = preamble.slice(day.end);
  if (preamble.trim()) sections.push({ heading: null, headingIndex: null, body: preamble.trim() });
  headings.forEach((heading, headingIndex) => {
    sections.push({ heading: plainInline(heading.text).replace(/^\d+\.\s*/, "").trim(), headingIndex,
      body: block.content.slice(heading.end, headings[headingIndex + 1]?.start ?? block.content.length).trim() });
  });
  return sections;
}

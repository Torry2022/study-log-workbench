import { isValidLogDate } from "./study-date.ts";
import type { MarkdownHeading } from "./markdown-outline.ts";

export interface InternalLinkCandidate {
  kind: "day" | "heading";
  date: string;
  heading: string | null;
  headingId?: string;
  preview: string;
}

export function normalizeInternalLinkAlias(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function findInternalLinkHeading(headings: readonly MarkdownHeading[], target: string): MarkdownHeading | undefined {
  const requested = target.trim();
  if (!requested) return undefined;
  const exact = headings.find(heading => heading.id === requested)
    || headings.find(heading => heading.text === requested);
  if (exact) return exact;
  const normalized = (value: string) => value.replace(/^\s*\d+\.\s+/, "").replace(/\s+/g, " ").trim();
  return headings.find(heading => normalized(heading.text) === normalized(requested));
}

export function buildInternalLinkMarkup(candidate: InternalLinkCandidate, alias = ""): string {
  if (!isValidLogDate(candidate.date)) throw new Error("内部链接日期无效");
  if (candidate.heading && /[#|\r\n]|\]\]/.test(candidate.heading)) {
    throw new Error("目标标题包含内部链接不支持的字符");
  }
  if (candidate.headingId && (!candidate.heading || !/^[\w\u3400-\u9fff-]+$/u.test(candidate.headingId))) {
    throw new Error("目标小节标识无效");
  }
  const target = candidate.heading ? `${candidate.date}#${candidate.headingId || candidate.heading}` : candidate.date;
  const normalizedAlias = normalizeInternalLinkAlias(alias);
  if (/[|]|\]\]/.test(normalizedAlias)) throw new Error("显示文字不能包含 | 或 ]]");
  const defaultLabel = candidate.heading || candidate.date;
  const label = normalizedAlias || defaultLabel;
  const aliasPart = label !== (candidate.headingId || defaultLabel) ? `|${label}` : "";
  return `[[${target}${aliasPart}]]`;
}

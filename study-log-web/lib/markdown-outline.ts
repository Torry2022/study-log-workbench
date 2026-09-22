import { findRootAtxHeadings } from "./day-content.ts";

export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
  line: number;
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_~()[\]{}<>，。、“”‘’：；！？]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\u3400-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

export function buildMarkdownOutline(markdown: string): MarkdownHeading[] {
  const used = new Map<string, number>();
  const headings: MarkdownHeading[] = [];
  for (const heading of findRootAtxHeadings(markdown)) {
    const text = stripMarkdownInline(heading.text);
    if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) continue;

    const baseId = slugifyHeading(text);
    const count = used.get(baseId) || 0;
    used.set(baseId, count + 1);
    headings.push({
      id: count === 0 ? baseId : `${baseId}-${count + 1}`,
      level: heading.level,
      text,
      line: heading.line
    });
  }

  return headings;
}

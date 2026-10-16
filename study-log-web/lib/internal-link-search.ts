import { listSavedDayContents } from "./log-store.ts";
import { findRootAtxHeadings } from "./day-content.ts";
import { buildMarkdownOutline } from "./markdown-outline.ts";
import { isValidLogDate } from "./study-date.ts";
import type { InternalLinkCandidate } from "./internal-links.ts";

function cleanInternalLinkText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getInternalLinkSections(markdown: string): Array<{ heading: string; headingId?: string; body: string }> {
  const headings = findRootAtxHeadings(markdown, 3);
  const outline = new Map(buildMarkdownOutline(markdown).map(heading => [heading.line, heading]));
  const sections = headings.map((node, index) => ({
    heading: (outline.get(node.line)?.text || node.text).replace(/^\d+\.\s+/, "").trim(),
    id: outline.get(node.line)?.id,
    body: markdown.slice(node.end, headings[index + 1]?.start ?? markdown.length)
  })).filter(({ heading }) => heading && !/[#|]|\]\]/.test(heading));
  const counts = new Map<string, number>();
  for (const section of sections) counts.set(section.heading, (counts.get(section.heading) || 0) + 1);
  return sections.map(section => ({ heading: section.heading,
    headingId: (counts.get(section.heading) || 0) > 1 ? section.id : undefined, body: section.body }));
}

export async function searchInternalLinkCandidates(
  query: string,
  limit = 40,
  options: { ignoreCase?: boolean; headingsOnly?: boolean; date?: string; offset?: number } = {}
): Promise<InternalLinkCandidate[]> {
  if (options.date && !isValidLogDate(options.date)) throw new Error("日期无效，请选择有效日期");
  const normalize = (text: string) => options.ignoreCase === false ? text : text.toLocaleLowerCase();
  const normalizedQuery = normalize(query.trim());
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 81) : 40;
  const offset = Number.isSafeInteger(options.offset) && options.offset! > 0 ? options.offset! : 0;
  const blocks = (await listSavedDayContents()).sort((a, b) => b.date.localeCompare(a.date));
  const scored: Array<{ candidate: InternalLinkCandidate; score: number }> = [];

  for (const block of blocks) {
    if (options.date && block.date !== options.date) continue;
    const sections = getInternalLinkSections(block.content);
    const dayContent = cleanInternalLinkText(block.content);
    const dayPreview = dayContent.slice(0, 180);
    const dateText = normalize(block.date);
    const dayText = normalize(`${dateText} ${dayContent}`);

    if (!options.headingsOnly && (!normalizedQuery || dayText.includes(normalizedQuery))) {
      let score = normalizedQuery ? 30 : 10;
      if (normalizedQuery) {
        if (dateText === normalizedQuery) score = 110;
        else if (dateText.startsWith(normalizedQuery)) score = 85;
        else if (dateText.includes(normalizedQuery)) score = 70;
      }
      scored.push({
        candidate: {
          kind: "day",
          date: block.date,
          heading: null,
          preview: dayPreview
        },
        score
      });
    }

    for (const section of sections) {
      const headingText = normalize(section.heading);
      const sectionContent = cleanInternalLinkText(section.body);
      const preview = sectionContent.slice(0, 180);
      const sectionText = options.headingsOnly ? headingText : normalize(`${headingText} ${sectionContent}`);
      if (normalizedQuery && !dateText.includes(normalizedQuery) && !sectionText.includes(normalizedQuery)) {
        continue;
      }

      let score = normalizedQuery ? 45 : 9;
      if (normalizedQuery) {
        if (headingText === normalizedQuery) score = 105;
        else if (headingText.startsWith(normalizedQuery)) score = 90;
        else if (headingText.includes(normalizedQuery)) score = 80;
        else if (dateText === normalizedQuery) score = 75;
        else if (dateText.includes(normalizedQuery)) score = 60;
      }

      scored.push({
        candidate: {
          kind: "heading",
          date: block.date,
          heading: section.heading,
          headingId: section.headingId,
          preview
        },
        score
      });
    }
  }

  return scored
    .sort((a, b) => (normalizedQuery ? b.score - a.score : 0) || b.candidate.date.localeCompare(a.candidate.date)
      || Number(a.candidate.kind === "heading") - Number(b.candidate.kind === "heading"))
    .slice(offset, offset + safeLimit)
    .map(({ candidate }) => candidate);
}

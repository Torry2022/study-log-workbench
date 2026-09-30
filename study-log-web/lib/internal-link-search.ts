import { listSavedDayContents } from "./log-store.ts";
import { findRootAtxHeadings } from "./day-content.ts";
import { buildMarkdownOutline } from "./markdown-outline.ts";
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
  limit = 40
): Promise<InternalLinkCandidate[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 80) : 40;
  const blocks = (await listSavedDayContents()).sort((a, b) => b.date.localeCompare(a.date));
  const scored: Array<{ candidate: InternalLinkCandidate; score: number }> = [];

  for (const block of blocks) {
    const sections = getInternalLinkSections(block.content);
    const dayContent = cleanInternalLinkText(block.content);
    const dayPreview = dayContent.slice(0, 180);
    const dateText = block.date.toLocaleLowerCase();
    const dayText = `${dateText} ${dayContent}`.toLocaleLowerCase();

    if (!normalizedQuery || dayText.includes(normalizedQuery)) {
      let score = normalizedQuery ? 30 : 10;
      if (dateText === normalizedQuery) score = 110;
      else if (dateText.startsWith(normalizedQuery)) score = 85;
      else if (dateText.includes(normalizedQuery)) score = 70;
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
      const headingText = section.heading.toLocaleLowerCase();
      const sectionContent = cleanInternalLinkText(section.body);
      const preview = sectionContent.slice(0, 180);
      const sectionText = `${headingText} ${sectionContent}`.toLocaleLowerCase();
      if (normalizedQuery && !dateText.includes(normalizedQuery) && !sectionText.includes(normalizedQuery)) {
        continue;
      }

      let score = normalizedQuery ? 45 : 9;
      if (headingText === normalizedQuery) score = 105;
      else if (headingText.startsWith(normalizedQuery)) score = 90;
      else if (headingText.includes(normalizedQuery)) score = 80;
      else if (dateText === normalizedQuery) score = 75;
      else if (dateText.includes(normalizedQuery)) score = 60;

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
    .sort((a, b) => b.score - a.score || b.candidate.date.localeCompare(a.candidate.date)
      || Number(b.candidate.kind === "heading") - Number(a.candidate.kind === "heading"))
    .slice(0, safeLimit)
    .map(({ candidate }) => candidate);
}

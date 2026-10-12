import { createHash } from "node:crypto";
import { assertDate, rootHeadings, plainInline } from "./markdown-source.mjs";
import { SourceError } from "./paths.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");

/** Cursor binds the ordered day set and contents, so pages cannot mix revisions. */
export function readLogRange(blocks, { dateFrom, dateTo, cursor, maxChars = 30000 }) {
  assertDate(dateFrom); assertDate(dateTo);
  if (dateFrom > dateTo || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 30000) throw new SourceError("Invalid range.", "INVALID_ARGUMENT");
  const days = blocks.filter(day => day.date >= dateFrom && day.date <= dateTo).sort((a, b) => a.date.localeCompare(b.date));
  const revision = hash(JSON.stringify(days.map(day => [day.date, day.fileName, day.content])));
  let index = 0, offset = 0;
  if (cursor) {
    const match = /^([a-f0-9]{64}):(\d+):(\d+)$/.exec(cursor);
    if (!match || match[1] !== revision) throw new SourceError("Source changed; restart range reading.", "SOURCE_CHANGED");
    index = Number(match[2]); offset = Number(match[3]);
    if (index >= days.length || offset >= days[index].content.length) throw new SourceError("Invalid cursor.", "INVALID_ARGUMENT");
  }
  const contexts = [], completedDates = [];
  let totalChars = 0;
  while (index < days.length && contexts.length < 20 && totalChars < maxChars) {
    const day = days[index];
    const content = day.content.slice(offset, offset + maxChars - totalChars);
    if (!content) { completedDates.push(day.date); index++; offset = 0; continue; }
    const end = offset + content.length;
    const headings = rootHeadings(day.content, 3);
    const sectionIndex = headings.findLastIndex(heading => heading.start <= offset);
    const singleSection = sectionIndex >= 0 && end <= (headings[sectionIndex + 1]?.start ?? day.content.length);
    const title = singleSection ? plainInline(headings[sectionIndex].text).replace(/^\d+\.\s*/, "").trim() : "";
    contexts.push({ sourceId: `S${contexts.length + 1}`, date: day.date, month: day.month, fileName: day.fileName,
      heading: null, headingIndex: null, chunkId: `${day.date}:range:${offset}`, contentHash: hash(day.content), dayContentHash: hash(day.content),
      ...(title ? { rangeSection: { heading: title, headingIndex: sectionIndex } } : {}),
      content, excerpt: content.slice(0, 200), truncated: end < day.content.length || offset > 0, score: 1 });
    totalChars += content.length;
    if (end < day.content.length) { offset = end; break; }
    completedDates.push(day.date); index++; offset = 0;
  }
  const nextCursor = index < days.length ? `${revision}:${index}:${offset}` : null;
  return { contexts, context: { maxChunks: 20, maxChars, returnedChunks: contexts.length, totalChars, truncated: nextCursor !== null, dateFrom, dateTo },
    coverage: { revision, totalDays: days.length, completedDates, nextCursor } };
}

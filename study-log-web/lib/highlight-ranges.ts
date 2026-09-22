import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
interface Node { type: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } }
interface HighlightToken { id: string; start: number; end: number }
export interface HighlightSegment { id: string; start: number; end: number; text: string; tokens: HighlightToken[]; taggedText: string }
export interface HighlightRange { start: number; end: number }
const protectedTypes = new Set(["heading", "code", "inlineCode", "link", "linkReference", "image", "imageReference", "strong", "definition", "html", "math", "inlineMath"]);
const words = new Intl.Segmenter("zh-CN", { granularity: "word" });

/** Source offsets belong to the original UTF-16 string; Markdown is never serialized. */
export function collectHighlightSegments(content: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  // Internal links can span several AST leaves (for example a bold alias).
  const internalLinks = [...content.matchAll(/\[\[[^\r\n]*?\]\]/g)].map(match => [match.index!, match.index! + match[0].length]);
  function add(start: number, end: number): void {
    if (start >= end) return;
    const text = content.slice(start, end), id = `S${segments.length + 1}`;
    const tokens: HighlightToken[] = [], markers = new Map<number, string>();
    for (const word of words.segment(text)) {
      if (!word.isWordLike || !word.segment.trim()) continue;
      const tokenId = `${id}T${tokens.length + 1}`;
      tokens.push({ id: tokenId, start: start + word.index, end: start + word.index + word.segment.length });
      markers.set(word.index, tokenId);
    }
    if (!tokens.length) return;
    let taggedText = "";
    for (let i = 0; i < text.length; i++) taggedText += `${markers.has(i) ? `[${markers.get(i)}]` : ""}${text[i]}`;
    segments.push({ id, start, end, text, tokens, taggedText });
  }
  function visit(node: Node): void {
    if (protectedTypes.has(node.type)) return;
    // Inline HTML is opaque to Markdown's tree; conservatively keep its whole
    // inline container untouched, including <a> and <strong> contents.
    if (["paragraph", "tableCell", "emphasis", "delete"].includes(node.type) && node.children?.some(child => child.type === "html")) return;
    if (node.type === "text" && node.position) {
      const start = node.position.start.offset, end = node.position.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = content.slice(start, end);
      // These constructs have a source representation different from plain text.
      // Split around them instead of inventing a decoded-to-source offset mapping.
      const unsafe = /\r?\n|\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/gi;
      const blocked = internalLinks.filter(([from, to]) => from < end && to > start)
        .map(([from, to]) => [Math.max(start, from), Math.min(end, to)]);
      for (const match of raw.matchAll(unsafe)) {
        blocked.push([start + match.index!, start + match.index! + match[0].length]);
      }
      let cursor = start;
      for (const [from, to] of blocked.sort((a, b) => a[0] - b[0])) {
        add(cursor, from);
        cursor = Math.max(cursor, to);
      }
      add(cursor, end);
      return;
    }
    node.children?.forEach(visit);
  }
  visit(parser.parse(content) as Node);
  return segments;
}

/** Pure insertion only. No trimming, normalization, line-ending changes or model text. */
export function applyHighlightRanges(content: string, ranges: HighlightRange[]): string {
  let result = content;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, range.start) + "**" + result.slice(range.start, range.end) + "**" + result.slice(range.end);
  }
  return result;
}

function renderedRanges(content: string, ranges: HighlightRange[]): Set<number> {
  const found = new Set<string>();
  function visit(node: Node): void {
    if (node.type === "strong" && node.position) found.add(`${node.position.start.offset}:${node.position.end.offset}`);
    node.children?.forEach(visit);
  }
  visit(parser.parse(applyHighlightRanges(content, ranges)) as Node);
  return new Set(ranges.flatMap((range, index) => found.has(`${range.start + index * 4}:${range.end + index * 4 + 4}`) ? [index] : []));
}

export function applyHighlightCandidates(content: string, candidates: unknown[]): { content: string; boldCount: number; warnings: string[]; ranges: HighlightRange[] } {
  const segments = collectHighlightSegments(content);
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  let ranges: HighlightRange[] = [];
  let skipped = Math.max(0, candidates.length - 200);
  for (const value of candidates.slice(0, 200)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { skipped++; continue; }
    const candidate = value as { startTokenId?: unknown; endTokenId?: unknown };
    const startId = typeof candidate.startTokenId === "string" ? candidate.startTokenId.trim().toUpperCase() : "";
    const endId = candidate.endTokenId === undefined ? startId : typeof candidate.endTokenId === "string" ? candidate.endTokenId.trim().toUpperCase() : "";
    const startMatch = startId.match(/^(S\d+)T\d+$/), endMatch = endId.match(/^(S\d+)T\d+$/);
    if (!startMatch || !endMatch || startMatch[1] !== endMatch[1]) { skipped++; continue; }
    const segment = byId.get(startMatch[1]);
    const first = segment?.tokens.find(token => token.id === startId), last = segment?.tokens.find(token => token.id === endId);
    if (!first || !last) { skipped++; continue; }
    const range = { start: Math.min(first.start, last.start), end: Math.max(first.end, last.end) };
    if (ranges.some(selected => range.start <= selected.end && range.end >= selected.start)) continue;
    ranges.push(range);
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.length) {
    // Asterisks next to existing syntax can otherwise create literal markers or
    // merge formatting. Accept only the precise strong nodes we intended.
    const rendered = renderedRanges(content, ranges);
    skipped += ranges.length - rendered.size;
    ranges = ranges.filter((_, index) => rendered.has(index));
    if (ranges.length && renderedRanges(content, ranges).size !== ranges.length) { skipped += ranges.length; ranges = []; }
  }
  const warnings: string[] = [];
  if (skipped) warnings.push(`模型返回了 ${skipped} 组无效或不安全定位标记，已忽略`);
  if (!ranges.length) warnings.push("本次没有新增可安全应用的重点标注，原文保持不变");
  return { content: applyHighlightRanges(content, ranges), boldCount: ranges.length, warnings, ranges };
}

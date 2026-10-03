import crypto from "node:crypto";
import { parseSections, assertDate } from "./markdown-source.mjs";
import { SourceError } from "./paths.mjs";

const MAX_CHUNK_CHARS = 2400;
const CHUNK_OVERLAP_CHARS = 200;
const RRF_K = 60;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const BM25_K3 = 8;
const TITLE_FIELD_WEIGHT = 2.5;
const MIN_RELATIVE_FUSION_SCORE = 0.6;
const MIN_CONTEXT_CHARS = 1000;
const DEFAULT_CONTEXT_CHARS = 12000;
const MAX_CONTEXT_CHARS = 30000;
const MIN_OVERLAP_CHARS = 20;
const RETRIEVAL_STRATEGIES = new Set(["relevance", "timeline_summary", "comparison"]);
const chineseWordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stripMarkdownInline(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEmbeddingText(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/^\s*---\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeSnippet(value, maxLength = 320) {
  return stripMarkdownInline(
    String(value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^\s*---\s*$/gm, "")
  ).slice(0, maxLength);
}

function tokenizeOccurrences(value) {
  const normalized = String(value || "").normalize("NFKC").toLowerCase();
  const tokens = [];
  for (const match of normalized.matchAll(/\d+(?:\.\d+)?%/g)) tokens.push(match[0]);
  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_+.#-]{1,}/g)) {
    tokens.push(match[0]);
  }
  for (const match of normalized.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    for (const segment of chineseWordSegmenter.segment(match[0])) {
      const token = segment.segment.trim();
      if (segment.isWordLike && token.length >= 2) tokens.push(token);
    }
  }
  return tokens;
}

export function tokenize(value) {
  return [...new Set(tokenizeOccurrences(value))];
}

function splitLongText(value, maxChars = MAX_CHUNK_CHARS, overlapChars = CHUNK_OVERLAP_CHARS) {
  const text = String(value || "").trim();
  if (!text) return [""];
  if (text.length <= maxChars) return [text];

  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + Math.floor(maxChars * 0.5)) end = paragraphBreak;
    }
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return parts;
}

export function buildSectionChunks(blocks) {
  const chunks = [];
  for (const block of blocks) {
    for (const section of parseSections(block)) {
      const parts = splitLongText(section.body);
      parts.forEach((part, partIndex) => {
        const cleanBody = cleanEmbeddingText(part);
        const embeddingText = [block.date, section.heading, cleanBody].filter(Boolean).join("\n");
        if (!embeddingText.trim()) return;
        const headingKey = section.headingIndex === null ? "preamble" : `h${section.headingIndex}`;
        chunks.push({
          id: `${block.fileName}:${block.date}:${headingKey}:p${partIndex}`,
          hash: hash(embeddingText),
          date: block.date,
          month: block.month,
          fileName: block.fileName,
          headings: block.headings,
          heading: section.heading,
          headingIndex: section.headingIndex,
          partIndex,
          text: part,
          embeddingText,
          snippet: makeSnippet(part),
          preview: block.preview
        });
      });
    }
  }
  return chunks;
}

function countTerms(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function buildLexicalCorpus(chunks) {
  const documents = new Map();
  const documentFrequency = new Map();
  let totalTitleLength = 0;
  let totalBodyLength = 0;

  for (const chunk of chunks) {
    const titleTokens = tokenizeOccurrences(chunk.heading || "");
    const bodyTokens = tokenizeOccurrences(stripMarkdownInline(chunk.text));
    const titleTerms = countTerms(titleTokens);
    const bodyTerms = countTerms(bodyTokens);
    documents.set(chunk.id, {
      titleTerms,
      bodyTerms,
      titleLength: titleTokens.length,
      bodyLength: bodyTokens.length
    });
    totalTitleLength += titleTokens.length;
    totalBodyLength += bodyTokens.length;
    for (const token of new Set([...titleTerms.keys(), ...bodyTerms.keys()])) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  return {
    documents,
    documentFrequency,
    documentCount: chunks.length,
    averageTitleLength: totalTitleLength / Math.max(chunks.length, 1) || 1,
    averageBodyLength: totalBodyLength / Math.max(chunks.length, 1) || 1
  };
}

function normalizedTermFrequency(termFrequency, fieldLength, averageFieldLength) {
  if (!termFrequency) return 0;
  return termFrequency / (1 - BM25_B + BM25_B * (fieldLength / averageFieldLength));
}

function lexicalScore(chunk, queryTerms, corpus) {
  const document = corpus.documents.get(chunk.id);
  if (!document || queryTerms.size === 0) return { score: 0, matchedTerms: [] };

  let score = 0;
  const matchedTerms = [];
  for (const [token, queryFrequency] of queryTerms) {
    const titleFrequency = document.titleTerms.get(token) || 0;
    const bodyFrequency = document.bodyTerms.get(token) || 0;
    if (!titleFrequency && !bodyFrequency) continue;

    const documentFrequency = corpus.documentFrequency.get(token) || 0;
    const inverseDocumentFrequency = Math.log(
      1 + (corpus.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)
    );
    const weightedFrequency =
      TITLE_FIELD_WEIGHT *
        normalizedTermFrequency(titleFrequency, document.titleLength, corpus.averageTitleLength) +
      normalizedTermFrequency(bodyFrequency, document.bodyLength, corpus.averageBodyLength);
    const documentWeight = ((BM25_K1 + 1) * weightedFrequency) / (BM25_K1 + weightedFrequency);
    const queryWeight = ((BM25_K3 + 1) * queryFrequency) / (BM25_K3 + queryFrequency);
    score += inverseDocumentFrequency * documentWeight * queryWeight;
    matchedTerms.push(token);
  }
  return { score, matchedTerms };
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function findBoundaryOverlap(left, right) {
  const maximum = Math.min(CHUNK_OVERLAP_CHARS, left.length, right.length);
  for (let length = maximum; length >= MIN_OVERLAP_CHARS; length -= 1) {
    if (left.endsWith(right.slice(0, length))) return length;
  }
  return 0;
}

function removeAdjacentChunkOverlap(chunk, selectedChunks) {
  let content = chunk.text;
  for (const selected of selectedChunks) {
    const sameSection = selected.date === chunk.date && selected.headingIndex === chunk.headingIndex;
    if (!sameSection) continue;

    if (selected.partIndex + 1 === chunk.partIndex) {
      const overlap = findBoundaryOverlap(selected.text, content);
      if (overlap) content = content.slice(overlap).trimStart();
    } else if (chunk.partIndex + 1 === selected.partIndex) {
      const overlap = findBoundaryOverlap(content, selected.text);
      if (overlap) content = content.slice(0, -overlap).trimEnd();
    }
  }
  return content;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return null;
  assertDate(value);
  return value;
}

function filterBlocksByDateRange(blocks, options = {}) {
  const dateFrom = normalizeDate(options.dateFrom), dateTo = normalizeDate(options.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) throw new SourceError("dateFrom must not be after dateTo.", "INVALID_ARGUMENT");
  return blocks.filter(block => (!dateFrom || block.date >= dateFrom) && (!dateTo || block.date <= dateTo));
}

function normalizeStrategy(value) {
  if (value === undefined) return "relevance";
  if (!RETRIEVAL_STRATEGIES.has(value)) throw new SourceError("Unknown retrieval strategy.", "INVALID_ARGUMENT");
  return value;
}

function sectionKey(chunk) {
  return JSON.stringify([chunk.fileName, chunk.date, chunk.headingIndex]);
}

function mergeSectionMatches(matches) {
  const ordered = [...matches].sort((left, right) => left.chunk.partIndex - right.chunk.partIndex);
  const selectedChunks = [];
  const contents = [];

  for (const match of ordered) {
    const content = removeAdjacentChunkOverlap(match.chunk, selectedChunks);
    if (content) contents.push(content);
    selectedChunks.push(match.chunk);
  }

  const primary = matches[0];
  const content = contents.join("\n\n");
  return {
    primary,
    content,
    chunkIds: ordered.map((match) => match.chunk.id),
    contentHashes: ordered.map((match) => match.chunk.hash),
    partIndexes: ordered.map((match) => match.chunk.partIndex),
    matchedTerms: [...new Set(matches.flatMap((match) => match.matchedTerms))]
  };
}

function normalizeLiteral(value) {
  return String(value || "").normalize("NFKC").trim();
}

function countLiteralOccurrences(value, literal) {
  if (!literal) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(literal, offset)) !== -1) {
    count += 1;
    offset += Math.max(literal.length, 1);
  }
  return count;
}

function rankLiteralSections(blocks, literalQuery) {
  const literal = normalizeLiteral(literalQuery);
  if (!literal) return [];

  const groups = new Map();
  for (const chunk of buildSectionChunks(blocks)) {
    const key = sectionKey(chunk);
    const group = groups.get(key) || [];
    group.push({
      chunk,
      keywordScore: 0,
      semanticScore: 0,
      matchedTerms: [literalQuery],
      score: 0
    });
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((matches) => {
      const merged = mergeSectionMatches(matches);
      const heading = normalizeLiteral(merged.primary.chunk.heading);
      const content = normalizeLiteral(merged.content);
      const headingMatches = countLiteralOccurrences(heading, literal);
      const contentMatches = countLiteralOccurrences(content, literal);
      const score = headingMatches * 1000 + contentMatches;
      return { matches, score, date: merged.primary.chunk.date };
    })
    .filter((section) => section.score > 0)
    .sort((left, right) => right.score - left.score || right.date.localeCompare(left.date))
    .flatMap((section) =>
      section.matches
        .sort((left, right) => left.chunk.partIndex - right.chunk.partIndex)
        .map((match) => ({ ...match, keywordScore: section.score, score: section.score }))
    );
}

function roundRobinBy(matches, keyForMatch, compareKeys) {
  const groups = new Map();
  for (const match of matches) {
    const key = keyForMatch(match);
    const group = groups.get(key) || [];
    group.push(match);
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort(compareKeys);
  const ordered = [];
  for (let offset = 0; ; offset += 1) {
    let added = false;
    for (const key of keys) {
      const match = groups.get(key)?.[offset];
      if (!match) continue;
      ordered.push(match);
      added = true;
    }
    if (!added) return ordered;
  }
}

function orderMatchesForStrategy(matches, strategy) {
  if (strategy === "timeline_summary") {
    return roundRobinBy(matches, (match) => match.chunk.date, (left, right) => right.localeCompare(left));
  }
  if (strategy === "comparison") {
    return roundRobinBy(
      matches,
      (match) => `${match.chunk.heading || "未命名"}`.normalize("NFKC").toLowerCase(),
      (left, right) => {
        const leftScore = matches.find((match) => `${match.chunk.heading || "未命名"}`.normalize("NFKC").toLowerCase() === left)?.score || 0;
        const rightScore = matches.find((match) => `${match.chunk.heading || "未命名"}`.normalize("NFKC").toLowerCase() === right)?.score || 0;
        return rightScore - leftScore || left.localeCompare(right);
      }
    );
  }
  return matches;
}

function normalizedContent(value) {
  return stripMarkdownInline(value).normalize("NFKC").toLowerCase();
}

function isNearDuplicateContent(value, selectedValues) {
  const normalized = normalizedContent(value);
  if (!normalized) return true;
  for (const selected of selectedValues) {
    if (normalized === selected.normalized) return true;
    const lengthRatio = Math.min(normalized.length, selected.normalized.length) / Math.max(normalized.length, selected.normalized.length);
    if (lengthRatio < 0.9) continue;
    const terms = new Set(tokenizeOccurrences(normalized));
    const selectedTerms = selected.terms;
    if (terms.size === 0 || selectedTerms.size === 0) continue;
    let intersection = 0;
    for (const term of terms) if (selectedTerms.has(term)) intersection += 1;
    const union = new Set([...terms, ...selectedTerms]).size;
    if (intersection / union >= 0.9) return true;
  }
  return false;
}


export { RRF_K, MIN_RELATIVE_FUSION_SCORE, MIN_CONTEXT_CHARS, DEFAULT_CONTEXT_CHARS, MAX_CONTEXT_CHARS, hash, makeSnippet, tokenizeOccurrences, countTerms, buildLexicalCorpus, lexicalScore, normalizeDate, filterBlocksByDateRange, normalizeStrategy, sectionKey, mergeSectionMatches, rankLiteralSections, orderMatchesForStrategy, normalizedContent, isNearDuplicateContent };

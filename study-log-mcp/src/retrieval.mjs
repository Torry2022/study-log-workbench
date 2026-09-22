import { RRF_K, MIN_RELATIVE_FUSION_SCORE, MIN_CONTEXT_CHARS, DEFAULT_CONTEXT_CHARS, MAX_CONTEXT_CHARS, hash, makeSnippet, tokenizeOccurrences, countTerms, buildLexicalCorpus, lexicalScore, normalizeDate, filterBlocksByDateRange, normalizeStrategy, sectionKey, mergeSectionMatches, rankLiteralSections, orderMatchesForStrategy, normalizedContent, isNearDuplicateContent, buildSectionChunks } from "./retrieval-core.mjs";
import { SourceError } from "./paths.mjs";
import { cosineSimilarity } from "./retrieval-core.mjs";
import { EmbeddingClient, RerankClient, ProviderError, checkCancelled } from "./providers.mjs";
import { VectorIndex, IndexError } from "./vector-index.mjs";
export { buildSectionChunks, tokenize } from "./retrieval-core.mjs";

function validateInput(input, options) {
  checkCancelled(options.signal);
  if (typeof input !== "string" || !input.trim() || input.length > 60000) throw new SourceError("Retrieval input must contain 1 to 60000 characters.", "INVALID_ARGUMENT");
  if (options.matchMode !== undefined && !["hybrid", "literal"].includes(options.matchMode)) throw new SourceError("Unknown match mode.", "INVALID_ARGUMENT");
  if (options.literalQuery !== undefined && (typeof options.literalQuery !== "string" || options.literalQuery.length > 60000)) throw new SourceError("Invalid literal query.", "INVALID_ARGUMENT");
  normalizeStrategy(options.strategy);
  if (options.rerank !== undefined && typeof options.rerank !== "boolean") throw new SourceError("rerank must be boolean.", "INVALID_ARGUMENT");
  for (const key of ["maxResults", "maxChunks", "maxChars"]) {
    if (options[key] !== undefined && (typeof options[key] !== "number" || !Number.isFinite(options[key]))) throw new SourceError("Expected a finite numeric limit.", "INVALID_ARGUMENT");
  }
}

export class KeywordRetriever {
  buildRankedMatches(chunks, input) {
    const queryTerms = countTerms(tokenizeOccurrences(input));
    const lexicalCorpus = buildLexicalCorpus(chunks);
    const byId = new Map();
    const lexicalRanked = chunks
      .map((chunk) => ({ chunk, ...lexicalScore(chunk, queryTerms, lexicalCorpus) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.chunk.date.localeCompare(a.chunk.date));

    lexicalRanked.forEach((item, index) => {
      byId.set(item.chunk.id, {
        chunk: item.chunk,
        keywordScore: item.score,
        semanticScore: 0,
        matchedTerms: item.matchedTerms,
        score: 1 / (RRF_K + index + 1)
      });
    });

    return [...byId.values()].sort((a, b) => b.score - a.score || b.chunk.date.localeCompare(a.chunk.date));
  }

  filterWeakMatches(ranked, relativeScore = MIN_RELATIVE_FUSION_SCORE) {
    if (ranked.length === 0) return ranked;
    const minimumScore = ranked[0].score * relativeScore;
    return ranked.filter((match) => match.score >= minimumScore);
  }

  aggregateByDay(ranked, maxResults) {
    const groups = new Map();
    for (const match of ranked) {
      const chunk = match.chunk;
      const rankingScore = match.rerankScore ?? match.score;
      const group = groups.get(chunk.date) || {
        date: chunk.date,
        month: chunk.month,
        fileName: chunk.fileName,
        headings: chunk.headings,
        score: rankingScore,
        matchedTerms: new Set(),
        preview: chunk.preview,
        matches: []
      };
      group.score = Math.max(group.score, rankingScore);
      match.matchedTerms.forEach((term) => group.matchedTerms.add(term));
      if (group.matches.length < 3) {
        group.matches.push({
          chunkId: chunk.id,
          heading: chunk.heading,
          headingIndex: chunk.headingIndex,
          snippet: chunk.snippet,
          score: match.score,
          ...(match.rerankScore === undefined ? {} : { rerankScore: match.rerankScore }),
          semanticScore: match.semanticScore,
          keywordScore: match.keywordScore
        });
      }
      groups.set(chunk.date, group);
    }

    return [...groups.values()]
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
      .slice(0, maxResults)
      .map((group) => ({ ...group, matchedTerms: [...group.matchedTerms].slice(0, 20) }));
  }

  async rankChunks(blocks, input, options = {}) {
    const chunks = buildSectionChunks(blocks);
    const strategy = normalizeStrategy(options.strategy);
    const ranked = this.buildRankedMatches(chunks, input);
    if (strategy === "timeline_summary") {
      const found = new Set(ranked.map(match => match.chunk.id));
      for (const chunk of chunks) if (!found.has(chunk.id)) ranked.push({ chunk, keywordScore: 0, semanticScore: 0, matchedTerms: [], score: 0 });
    }
    const selected = strategy === "timeline_summary" ? ranked : this.filterWeakMatches(ranked, strategy === "relevance" ? MIN_RELATIVE_FUSION_SCORE : 0.4);
    return { ranked: orderMatchesForStrategy(selected, strategy), retrieval: { mode: "lexical_fallback", strategy, model: null, dimensions: null, indexUpdatedAt: null } };
  }

  async findRelated(blocks, input, options = {}) {
    validateInput(input, options);
    const maxResults = Math.min(Math.max(Number(options.maxResults) || 8, 1), 20);
    const filteredBlocks = filterBlocksByDateRange(blocks, options);
    const { ranked, retrieval } = await this.rankChunks(filteredBlocks, input, options);
    return {
      results: this.aggregateByDay(ranked, maxResults),
      retrieval
    };
  }

  async retrieveContexts(blocks, input, options = {}) {
    validateInput(input, options);
    const maxChunks = Math.min(Math.max(Number(options.maxChunks) || 8, 1), 20);
    const maxChars = Math.min(
      Math.max(Number(options.maxChars) || DEFAULT_CONTEXT_CHARS, MIN_CONTEXT_CHARS),
      MAX_CONTEXT_CHARS
    );
    const filteredBlocks = filterBlocksByDateRange(blocks, options);
    const literalQuery = options.matchMode === "literal" ? String(options.literalQuery || input || "").trim() : "";
    let ranked;
    let retrieval;
    if (literalQuery) {
      ranked = rankLiteralSections(filteredBlocks, literalQuery);
      if (ranked.length > 0) {
        retrieval = {
          mode: "literal",
          strategy: "relevance",
          model: null,
          dimensions: null,
          indexUpdatedAt: null,
          literalQuery
        };
      } else {
        const fallback = await this.rankChunks(filteredBlocks, input, options);
        ranked = fallback.ranked;
        retrieval = {
          ...fallback.retrieval,
          mode: `literal_fallback_${fallback.retrieval.mode}`,
          literalQuery
        };
      }
    } else {
      ({ ranked, retrieval } = await this.rankChunks(filteredBlocks, input, options));
    }
    const sectionGroups = new Map();
    for (const match of ranked) {
      const key = sectionKey(match.chunk);
      const group = sectionGroups.get(key) || [];
      group.push(match);
      sectionGroups.set(key, group);
    }
    const contexts = [];
    const selectedContents = [];
    let totalChars = 0;

    for (const matches of sectionGroups.values()) {
      if (contexts.length >= maxChunks || totalChars >= maxChars) break;
      const merged = mergeSectionMatches(matches);
      const match = merged.primary;
      const chunk = match.chunk;
      const rankingScore = match.rerankScore ?? match.score;
      let content = merged.content;
      if (isNearDuplicateContent(content, selectedContents)) continue;
      const remainingChars = maxChars - totalChars;
      const truncated = content.length > remainingChars;
      if (truncated) content = content.slice(0, remainingChars).trimEnd();
      if (!content) continue;

      contexts.push({
        sourceId: `S${contexts.length + 1}`,
        chunkId: chunk.id,
        chunkIds: merged.chunkIds,
        contentHash: hash(merged.content),
        contentHashes: merged.contentHashes,
        date: chunk.date,
        month: chunk.month,
        fileName: chunk.fileName,
        heading: chunk.heading,
        headingIndex: chunk.headingIndex,
        partIndex: chunk.partIndex,
        partIndexes: merged.partIndexes,
        content,
        excerpt: makeSnippet(content, 700),
        truncated,
        score: rankingScore,
        ...(match.rerankScore === undefined ? {} : { rerankScore: match.rerankScore }),
        semanticScore: match.semanticScore,
        keywordScore: match.keywordScore,
        matchedTerms: merged.matchedTerms
      });
      totalChars += content.length;
      selectedContents.push({ normalized: normalizedContent(merged.content), terms: new Set(tokenizeOccurrences(merged.content)) });
      if (truncated) break;
    }

    return {
      contexts,
      retrieval,
      context: {
        maxChunks,
        maxChars,
        returnedChunks: contexts.length,
        totalChars,
        truncated: contexts.length < sectionGroups.size || contexts.some((context) => context.truncated),
        dateFrom: normalizeDate(options.dateFrom),
        dateTo: normalizeDate(options.dateTo),
        strategy: normalizeStrategy(options.strategy),
        matchMode: literalQuery ? "literal" : "hybrid"
      }
    };
  }
}

export class HybridRetriever extends KeywordRetriever {
  constructor(options = {}) {
    super();
    this.embeddingClient = options.embeddingClient || new EmbeddingClient(options.embedding);
    this.rerankClient = options.rerankClient || new RerankClient(options.reranker);
    this.rerankEnabled = options.rerankEnabled ?? process.env.RERANK_ENABLED === "true";
    if (typeof this.rerankEnabled !== "boolean") throw new SourceError("rerankEnabled must be boolean.", "INVALID_ARGUMENT");
    this.index = new VectorIndex(options);
  }

  buildRankedMatches(chunks, input, vectors = null, queryVector = null) {
    const lexical = super.buildRankedMatches(chunks, input);
    if (!vectors || !queryVector) return lexical;
    const byId = new Map(lexical.map(match => [match.chunk.id, match]));
    const semantic = chunks.map(chunk => ({ chunk, score: cosineSimilarity(queryVector, vectors[chunk.id]) }))
      .sort((a, b) => b.score - a.score).slice(0, 100);
    semantic.forEach((item, index) => {
      const match = byId.get(item.chunk.id) || { chunk: item.chunk, keywordScore: 0, matchedTerms: [], score: 0 };
      match.semanticScore = item.score; match.score += 1 / (RRF_K + index + 1); byId.set(item.chunk.id, match);
    });
    return [...byId.values()].sort((a, b) => b.score - a.score || b.chunk.date.localeCompare(a.chunk.date));
  }

  async rankChunks(blocks, input, options = {}) {
    checkCancelled(options.signal);
    const chunks = buildSectionChunks(blocks), strategy = normalizeStrategy(options.strategy);
    let ranked = this.buildRankedMatches(chunks, input);
    const retrieval = { mode: "lexical_fallback", strategy, model: null, dimensions: null, indexUpdatedAt: null };
    if (!chunks.length) retrieval.reason = "empty_source";
    else if (!this.embeddingClient.enabled) retrieval.reason = `embedding_${this.embeddingClient.issue || "not_configured"}`;
    else {
      try {
        const index = await this.index.sync(chunks, this.embeddingClient, { signal: options.signal });
        const [query] = await this.embeddingClient.embed([input], { signal: options.signal });
        if (!Array.isArray(query) || query.length !== this.embeddingClient.dimensions || query.some(value => !Number.isFinite(value))) throw new ProviderError("invalid_response", "Invalid query vector.");
        const vectors = Object.fromEntries(Object.entries(index.chunks).map(([id, item]) => [id, item.vector]));
        ranked = this.buildRankedMatches(chunks, input, vectors, query);
        Object.assign(retrieval, { mode: "hybrid", model: this.embeddingClient.model, dimensions: this.embeddingClient.dimensions, indexUpdatedAt: index.updatedAt });
      } catch (error) {
        checkCancelled(options.signal);
        retrieval.reason = error instanceof ProviderError ? `embedding_${error.code}` : error instanceof IndexError && error.code === "instance_identity_unavailable" ? error.code : "index_unavailable";
      }
    }
    if (strategy === "timeline_summary") {
      const found = new Set(ranked.map(match => match.chunk.id));
      for (const chunk of chunks) if (!found.has(chunk.id)) ranked.push({ chunk, keywordScore: 0, semanticScore: 0, matchedTerms: [], score: 0 });
    }
    let selected = strategy === "timeline_summary" ? ranked : this.filterWeakMatches(ranked, strategy === "relevance" ? MIN_RELATIVE_FUSION_SCORE : 0.4);
    if (options.rerank ?? this.rerankEnabled) {
      let rerank = { status: "skipped", model: this.rerankClient.model || null, candidateCount: 0, latencyMs: 0 };
      if (strategy !== "relevance") rerank.reason = "strategy_not_supported";
      else if (!this.rerankClient.enabled) rerank.reason = this.rerankClient.issue || "not_configured";
      else if (!selected.length) rerank.reason = "no_candidates";
      else {
        const candidates = selected.slice(0, 30), started = Date.now();
        try {
          const results = await this.rerankClient.rerank(input, candidates.map(match => match.chunk.embeddingText), { signal: options.signal });
          selected = [...results.map(result => ({ ...candidates[result.index], rerankScore: result.score })), ...selected.slice(candidates.length)];
          rerank = { status: "applied", model: this.rerankClient.model, candidateCount: candidates.length, latencyMs: Date.now() - started };
        } catch (error) {
          checkCancelled(options.signal);
          rerank = { ...rerank, status: "fallback", candidateCount: candidates.length, latencyMs: Date.now() - started,
            reason: error instanceof ProviderError ? error.code : "rerank_failed" };
        }
      }
      retrieval.rerank = rerank;
    }
    checkCancelled(options.signal);
    return { ranked: orderMatchesForStrategy(selected, strategy), retrieval };
  }
}

export const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
export class ProviderError extends Error {
  constructor(code, message) { super(message); this.name = "ProviderError"; this.code = code; }
}
export function checkCancelled(signal) {
  if (signal?.aborted) throw new ProviderError("cancelled", "Retrieval request cancelled.");
}

function configuration(prefix, options) {
  const value = (option, variable, fallback = "") => options[option] ?? process.env[`${prefix}_${variable}`] ?? fallback;
  const rawKey = value("apiKey", "API_KEY"), rawUrl = value("apiUrl", "API_URL"), rawModel = value("model", "MODEL");
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const apiUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const model = typeof rawModel === "string" ? rawModel.trim() : "";
  const timeoutMs = Number(value("timeoutMs", "TIMEOUT_MS", 30000));
  const dimensions = prefix === "EMBEDDING" ? Number(value("dimensions", "DIMENSIONS", 1024)) : null;
  let issue = !apiKey || !apiUrl || !model ? "not_configured" : null;
  let validUrl = false;
  try { const url = new URL(apiUrl); validUrl = /^https?:\/\//i.test(apiUrl) && ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !apiUrl.includes("#") && !/[\\\u0000-\u0020\u007f]/.test(apiUrl); } catch { /* incomplete URL remains disabled */ }
  if ((apiUrl && !validUrl) || /[^\x21-\x7e]/.test(apiKey) || /[\u0000-\u001f\u007f]/.test(model) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      (dimensions !== null && (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65536)) ||
      [rawKey, rawUrl, rawModel].some(item => typeof item !== "string")) issue = "invalid_configuration";
  return Object.freeze({ apiKey, apiUrl, model, timeoutMs, dimensions, issue });
}

async function requestProvider(config, body, signal) {
  checkCancelled(signal);
  if (config.issue) throw new ProviderError(config.issue, "Provider requires valid explicit credentials, endpoint and model configuration.");
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), config.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    const response = await fetch(config.apiUrl, { method: "POST", redirect: "error", signal: combined,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body) });
    combined.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(response.status === 429 ? "rate_limited" : "provider_failed", "Provider request failed; keyword retrieval remains available.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError("invalid_response", "Provider returned an invalid response.");
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const item = await reader.read(); combined.throwIfAborted(); if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new ProviderError("response_too_large", "Provider response exceeded the size limit.");
        chunks.push(item.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new ProviderError("invalid_response", "Provider returned invalid JSON."); }
  } catch (error) {
    checkCancelled(signal);
    if (deadline.signal.aborted) throw new ProviderError("timeout", "Provider request timed out.");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("network_error", "Provider could not be reached.");
  } finally { clearTimeout(timer); }
}

export class EmbeddingClient {
  #config;
  constructor(options = {}) { this.#config = configuration("EMBEDDING", options); }
  get enabled() { return !this.#config.issue; }
  get issue() { return this.#config.issue; }
  get apiUrl() { return this.#config.apiUrl; }
  get model() { return this.#config.model; }
  get dimensions() { return this.#config.dimensions; }
  async embed(inputs, { signal } = {}) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10 || inputs.some(input => typeof input !== "string")) throw new ProviderError("invalid_input", "Embedding batch must contain 1 to 10 texts.");
    const payload = await requestProvider(this.#config, { model: this.model, input: inputs, dimensions: this.dimensions, encoding_format: "float" }, signal);
    const data = Array.isArray(payload?.data) ? [...payload.data].sort((a, b) => a?.index - b?.index) : [];
    if (data.length !== inputs.length || data.some((item, index) => item?.index !== index || !Array.isArray(item.embedding) || item.embedding.length !== this.dimensions || item.embedding.some(value => typeof value !== "number" || !Number.isFinite(value)))) throw new ProviderError("invalid_response", "Provider returned invalid embedding vectors.");
    return data.map(item => item.embedding);
  }
}

export class RerankClient {
  #config;
  constructor(options = {}) { this.#config = configuration("RERANK", options); }
  get enabled() { return !this.#config.issue; }
  get issue() { return this.#config.issue; }
  get model() { return this.#config.model; }
  async rerank(query, documents, { signal } = {}) {
    if (typeof query !== "string" || !Array.isArray(documents) || documents.length > 30 || documents.some(item => typeof item !== "string")) throw new ProviderError("invalid_input", "Rerank input must contain a query and at most 30 texts.");
    if (!documents.length) return [];
    const payload = await requestProvider(this.#config, { model: this.model, query, documents, top_n: documents.length,
      instruct: "Given a query, retrieve passages that answer the query." }, signal);
    const results = Array.isArray(payload?.results) ? payload.results : [], seen = new Set();
    if (results.length !== documents.length || results.some(item => {
      if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= documents.length || typeof item.relevance_score !== "number" || !Number.isFinite(item.relevance_score) || seen.has(item.index)) return true;
      seen.add(item.index); return false;
    })) throw new ProviderError("invalid_response", "Provider returned invalid reranking results.");
    return results.map(item => ({ index: item.index, score: item.relevance_score })).sort((a, b) => b.score - a.score || a.index - b.index);
  }
}

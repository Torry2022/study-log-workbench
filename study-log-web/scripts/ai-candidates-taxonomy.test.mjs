import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as candidates from "../lib/note-candidates.ts";
import * as taxonomy from "../lib/ai-taxonomy.ts";
import * as chat from "../lib/ai-chat.ts";
import * as config from "../lib/ai-config.ts";
import * as prompts from "../lib/ai-prompts.ts";
import { readTaxonomy } from "../lib/taxonomy-store.ts";
import { createStudyNotes, listStudyNotes } from "../lib/notes-store.ts";

const document = (text = "技术 API（定义）保留空格。\n\n另一个原文段落。") => ({ fileName: "synthetic.md", fileType: "markdown", size: Buffer.byteLength(text), text, sections: [{ id: "S1", locator: "合成小节", text }], warnings: ["合成解析提示"] });
const candidate = (fields = {}) => ({ kind: "explicit", title: "技术 API（定义）", body: "中文 API（定义）保留空格。", tags: ["Known Tag", " known tag ", "新标签", "新标签"], evidence: [{ sourceId: "D1S1P1" }], ...fields });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-ai-suggestions-"));
  const data = path.join(root, "data"); await fs.mkdir(path.join(data, "prompts"), { recursive: true });
  const backups = path.join(root, "backups"); await fs.mkdir(backups);
  await fs.writeFile(path.join(data, "prompts", "extraction.md"), "合成可编辑提取模板；依据材料处理技术概念或其他信息。");
  const state = { requests: [], respond: () => ({ candidates: [] }) };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const sent = JSON.parse(Buffer.concat(chunks).toString("utf8")); state.requests.push(sent);
      const result = await state.respond(sent);
      if (result === undefined) return;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: typeof result === "string" ? result : JSON.stringify(result) }, finish_reason: "stop" }] }));
    } catch { res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const changed = { LOG_ROOT: data, BACKUP_ROOT: backups, CHAT_API_KEY: "synthetic-private-value", CHAT_API_URL: `http://127.0.0.1:${server.address().port}/chat/completions`, CHAT_MODEL: "synthetic-main", CHAT_LIGHT_MODEL: "synthetic-light" };
  const previous = Object.fromEntries(Object.keys(changed).map(key => [key, process.env[key]])); Object.assign(process.env, changed);
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-ai-suggestions-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const taxonomyFile = path.join(data, ".study-log-taxonomy.json");
  return { root, data, state, taxonomyFile, async setTaxonomy(domains = ["合成领域", "其他"], mappings = {}) {
    await fs.writeFile(taxonomyFile, JSON.stringify({ domains, mappings, updatedAt: null }));
    return readTaxonomy();
  } };
}

test("candidate sources are actual document substrings with stable document/section/paragraph identities", () => {
  const first = document("a".repeat(810) + "\n\nsecond paragraph"); first.sections[0].locator = "段落 7-8";
  const docs = [first, document("another document")];
  assert.equal(candidates.validateCandidateDocuments(docs), docs);
  const sources = candidates.buildCandidateSources(docs);
  assert.deepEqual(sources.map(source => source.id), ["D1S1P1", "D1S1P2", "D1S1P3", "D2S1P1"]);
  assert.match(sources[0].label, /段落 7.*片段 1/); assert.match(sources[2].label, /段落 8$/);
  for (const source of sources) assert.ok(docs.some(doc => doc.text.includes(source.text)));
  for (const bad of [[], Array.from({ length: 6 }, () => document()), [{ ...document(), sections: [{ id: "S1", locator: "fake", text: "not in original" }] }], [document("x".repeat(160_001))], [{ ...document(), warnings: [null] }], [{ ...document(), fileType: "html" }]]) assert.throws(() => candidates.validateCandidateDocuments(bad), candidates.NoteCandidateInputError);
});

test("normalization preserves user typography, bounds and deduplicates candidates/tags, and never accepts invented quotes", () => {
  const sources = candidates.buildCandidateSources([document()]);
  const result = candidates.normalizeStudyNoteCandidates([null, candidate({ evidence: [{ sourceId: "D1S1P1", quote: "invented quote" }, { sourceId: "D1S1P1" }, { sourceId: "missing" }] }), candidate(), candidate({ title: "无依据", evidence: [{ sourceId: "missing" }] })], sources, [{ value: "Known Tag", count: 3 }]);
  assert.equal(result.candidates.length, 1);
  assert.match(result.candidates[0].id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(result.candidates[0].title, "技术 API（定义）"); assert.equal(result.candidates[0].body, "中文 API（定义）保留空格。");
  assert.equal(result.candidates[0].insight, "");
  assert.deepEqual(result.candidates[0].tags, ["Known Tag", "新标签"]); assert.deepEqual(result.candidates[0].newTags, ["新标签"]);
  assert.deepEqual(result.candidates[0].evidence, [{ sourceId: "D1S1P1", sourceLabel: sources[0].label, quote: sources[0].text }]);
  assert.ok(result.warnings.some(warning => warning.includes("引用"))); assert.ok(result.warnings.some(warning => warning.includes("依据")));
  const many = candidates.normalizeStudyNoteCandidates(Array.from({ length: 20 }, (_, index) => candidate({ title: `Candidate ${index}` })), sources);
  assert.equal(many.candidates.length, 12);
  assert.equal(candidates.normalizeStudyNoteCandidates([candidate({ title: "C++", body: "C++" }), candidate({ title: "C#", body: "C#" })], sources).candidates.length, 2);
  assert.equal(candidates.normalizeStudyNoteCandidates([candidate({ body: "```md\n## code heading\n```" })], sources).candidates.length, 1);
  assert.equal(candidates.normalizeStudyNoteCandidates([candidate({ body: "## actual H2" })], sources).candidates.length, 0);
});

test("server-generated candidate UUIDs can be saved as one real batch and replayed without duplicates", async t => {
  const { state } = await fixture(t);
  state.respond = () => ({ candidates: [candidate(), candidate({ title: "Another candidate", body: "Another body" })] });
  const result = await candidates.extractStudyNoteCandidates([document()]);
  assert.equal(new Set(result.candidates.map(item => item.id)).size, 2);
  const payload = result.candidates.map(item => ({ clientId: item.id, title: item.title, body: item.body, insight: item.insight, sources: item.sources, tags: item.tags, recordedAt: "2026-08-01T09:30" }));
  const created = await createStudyNotes(payload);
  assert.deepEqual(created.map(item => item.id), result.candidates.map(item => item.id));
  assert.deepEqual(await createStudyNotes(payload), created);
  assert.equal((await listStudyNotes()).notes.length, 2);
});

test("extraction calls only local mock with instance template/light model and returns summaries without writing notes", async t => {
  const { data, state } = await fixture(t);
  state.respond = () => ({ candidates: [candidate()] });
  const before = await fs.readdir(data);
  const result = await candidates.extractStudyNoteCandidates([document()], [{ value: "Known Tag", count: 3 }]);
  assert.equal(state.requests.length, 1); assert.equal(state.requests[0].model, "synthetic-light");
  assert.match(state.requests[0].messages[0].content, /合成可编辑提取模板/);
  assert.doesNotMatch(state.requests[0].messages[0].content, /不要提取纯技术|半角英文括号|行业洞察、职业选择/);
  assert.equal(result.candidates.length, 1); assert.ok(result.warnings.includes("synthetic.md：合成解析提示"));
  assert.deepEqual(Object.keys(result.documents[0]), ["fileName", "fileType", "size", "sectionCount"]);
  assert.deepEqual(await fs.readdir(data), before);
  await fs.writeFile(path.join(data, "prompts", "extraction.md"), "修改后的实例模板");
  await candidates.extractStudyNoteCandidates([document()]); assert.match(state.requests[1].messages[0].content, /修改后的实例模板/);
});

test("extraction rejects malformed response/config/template/input and propagates cancellation without a late candidate", async t => {
  const { data, state } = await fixture(t);
  for (const response of ["{broken", { candidates: {} }, null]) {
    state.respond = () => response; await assert.rejects(candidates.extractStudyNoteCandidates([document()]), error => error.code === "AI_INVALID_RESPONSE");
  }
  const calls = state.requests.length;
  await assert.rejects(candidates.extractStudyNoteCandidates([]), candidates.NoteCandidateInputError);
  delete process.env.CHAT_API_KEY; await assert.rejects(candidates.extractStudyNoteCandidates([document()]), config.ChatConfigurationError);
  process.env.CHAT_API_KEY = "synthetic-private-value";
  await fs.writeFile(path.join(data, "prompts", "extraction.md"), " ");
  await assert.rejects(candidates.extractStudyNoteCandidates([document()]), prompts.WritingPromptError); assert.equal(state.requests.length, calls);
  await fs.writeFile(path.join(data, "prompts", "extraction.md"), "synthetic template");
  const controller = new AbortController(); let arrived;
  const started = new Promise(resolve => { arrived = resolve; }); state.respond = () => { arrived(); return undefined; };
  const pending = candidates.extractStudyNoteCandidates([document()], [], controller.signal); await started; controller.abort();
  await assert.rejects(pending, error => error.code === "AI_CANCELLED");
});

test("only Other yields explicit no-model advice even with no AI configuration", async t => {
  const { data, state } = await fixture(t); delete process.env.CHAT_API_KEY;
  const result = await taxonomy.suggestTaxonomy({ items: [{ tag: "Synthetic" }], domains: ["attacker supplied domain"] });
  assert.deepEqual(result.suggestions, []); assert.equal(result.model, null); assert.equal(result.snapshotVersion, null);
  assert.match(result.warnings[0], /未调用模型/); assert.equal(state.requests.length, 0);
  assert.deepEqual(await fs.readdir(data), ["prompts"]);
});

test("taxonomy uses server domains/snapshot/examples, rejects out-of-batch inventions and deduplicates suggestions", async t => {
  const { state, setTaxonomy, taxonomyFile } = await fixture(t);
  const initial = await setTaxonomy(["合成领域", "其他"], { Reference: "合成领域" });
  const original = await fs.readFile(taxonomyFile, "utf8");
  state.respond = sent => {
    const payload = JSON.parse(sent.messages[1].content);
    assert.deepEqual(payload.domains, ["合成领域", "其他"]); assert.deepEqual(payload.examples, [{ tag: "Reference", domain: "合成领域" }]);
    assert.doesNotMatch(sent.messages[0].content, /大模型与Agent|NLP与机器学习|AI工程与部署/);
    return { suggestions: [{ tag: payload.items[0].tag, domain: "合成领域", confidence: "high" }, { tag: payload.items[0].tag, domain: "其他" }, { tag: "T50", domain: "合成领域" }, { tag: "invention", domain: "合成领域" }, { tag: payload.items[0].tag, domain: "new domain" }] };
  };
  const result = await taxonomy.suggestTaxonomy({ items: Array.from({ length: 51 }, (_, index) => ({ tag: `T${index}`, sources: ["source", "source"] })), domains: ["not allowed"] });
  assert.equal(state.requests.length, 2); assert.equal(state.requests[0].model, "synthetic-light");
  assert.deepEqual(result.suggestions, [{ tag: "T0", domain: "合成领域", confidence: "high" }, { tag: "T50", domain: "合成领域", confidence: "high" }]);
  assert.equal(result.snapshotVersion, initial.version); assert.ok(result.warnings.length);
  assert.equal(await fs.readFile(taxonomyFile, "utf8"), original);
});

test("taxonomy inputs, malformed AI output and cancellation are bounded and produce no persisted mapping", async t => {
  const { state, setTaxonomy, taxonomyFile } = await fixture(t); await setTaxonomy();
  for (const input of [null, {}, { items: [] }, { items: [{ tag: "x", sources: "bad" }] }, { items: Array.from({ length: 201 }, () => ({ tag: "x" })) }]) await assert.rejects(taxonomy.suggestTaxonomy(input), taxonomy.TaxonomySuggestionInputError);
  assert.equal(state.requests.length, 0);
  for (const response of ["{broken", { suggestions: {} }, null]) { state.respond = () => response; await assert.rejects(taxonomy.suggestTaxonomy({ items: [{ tag: "x" }] }), error => error.code === "AI_INVALID_RESPONSE"); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(taxonomy.suggestTaxonomy({ items: [{ tag: "x" }] }, controller.signal), error => error.code === "AI_CANCELLED");
  assert.deepEqual(JSON.parse(await fs.readFile(taxonomyFile, "utf8")).mappings, {});
});

test("organize starts from Other, proposes bounded domains and never writes before review", async t => {
  const { data, state } = await fixture(t);
  state.respond = () => ({ domains: ["阅读", "技术", "unused", "", "x".repeat(41)], suggestions: [
    { tag: "读书(历史)", domain: "阅读" }, { tag: "排错", domain: "技术" },
    { tag: "invented", domain: "阅读" }, { tag: "读书(历史)", domain: "unlisted" }
  ] });
  const result = await taxonomy.suggestTaxonomy({ mode: "organize", items: [{ tag: "读书(历史)" }, { tag: "排错" }] });
  assert.deepEqual(result.proposedDomains, ["阅读", "技术"]);
  assert.equal(result.suggestions.length, 2);
  assert.deepEqual(JSON.parse(state.requests[0].messages[1].content).domains, ["其他"]);
  assert.deepEqual(await fs.readdir(data), ["prompts"]);
  delete process.env.CHAT_API_KEY;
  await assert.rejects(taxonomy.suggestTaxonomy({ mode: "organize", items: [{ tag: "排错" }] }), config.ChatConfigurationError);
});

test("organize protects exact and legacy saved mappings, reuses proposed domains across batches", async t => {
  const { state, setTaxonomy, taxonomyFile } = await fixture(t);
  await setTaxonomy(["旧领域", "其他"], { "读书": "旧领域", "保留": "其他" });
  const original = await fs.readFile(taxonomyFile, "utf8");
  state.respond = sent => {
    const payload = JSON.parse(sent.messages[1].content);
    assert.ok(!payload.items.some(item => ["读书(历史)", "保留"].includes(item.tag)));
    if (state.requests.length === 2) assert.ok(payload.domains.includes("新领域"));
    return { domains: ["新领域"], suggestions: payload.items.map(item => ({ tag: item.tag, domain: "新领域" })) };
  };
  const result = await taxonomy.suggestTaxonomy({ mode: "organize", items: [
    { tag: "读书(历史)" }, { tag: "保留" }, ...Array.from({ length: 51 }, (_, i) => ({ tag: `T${i}` }))
  ] });
  assert.equal(result.suggestions.length, 51); assert.deepEqual(result.proposedDomains, ["新领域"]);
  assert.equal(await fs.readFile(taxonomyFile, "utf8"), original);
  const calls = state.requests.length;
  const none = await taxonomy.suggestTaxonomy({ mode: "organize", items: [{ tag: "读书(心理学)" }] });
  assert.deepEqual(none.suggestions, []); assert.equal(state.requests.length, calls);
});

test("organize ignores excessive and malformed domain proposals, supports zero results", async t => {
  const { state } = await fixture(t);
  state.respond = () => ({ domains: Array.from({ length: 10 }, (_, i) => `D${i}`), suggestions: [{ tag: "x", domain: "D9" }] });
  const input = { mode: "organize", items: [{ tag: "x" }] };
  const result = await taxonomy.suggestTaxonomy(input);
  assert.deepEqual(result.suggestions, []); assert.deepEqual(result.proposedDomains, []); assert.ok(result.warnings.length);
  state.respond = () => ({ domains: {}, suggestions: [] });
  await assert.rejects(taxonomy.suggestTaxonomy(input), error => error.code === "AI_INVALID_RESPONSE");
  state.respond = () => ({ domains: [], suggestions: [] });
  assert.deepEqual((await taxonomy.suggestTaxonomy(input)).suggestions, []);
});

test("both authenticated routes enforce stream limits, safe errors and real service contracts", async t => {
  const { state, setTaxonomy } = await fixture(t);
  let authorized = false;
  const load = async (url, overrides = {}) => {
    const source = await fs.readFile(new URL(url, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const module = { exports: {} };
    const dependencies = { "@/lib/ai-chat": chat, "@/lib/ai-config": config, "@/lib/ai-prompts": prompts, "@/lib/note-candidates": candidates, "@/lib/ai-taxonomy": taxonomy,
      "@/lib/notes-store": { listStudyNotes: async () => ({ tags: [{ value: "Known Tag", count: 1 }] }) }, ...overrides };
    runInNewContext(outputText, { Response, TextDecoder, Buffer, exports: module.exports, require(name) {
      if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
      if (dependencies[name]) return dependencies[name]; throw new Error(`Unexpected dependency ${name}`);
    } }); return module.exports.POST;
  };
  const extractionRoute = await load("../app/api/notes/candidates/route.ts"), taxonomyRoute = await load("../app/api/taxonomy/suggest/route.ts");
  for (const route of [extractionRoute, taxonomyRoute]) assert.equal((await route({ get body() { assert.fail("unauthorized body access"); } })).status, 401);
  authorized = true;
  const send = (route, data) => route(new Request("http://localhost", { method: "POST", body: JSON.stringify(data) }));
  state.respond = () => ({ candidates: [candidate()] });
  const extracted = await send(extractionRoute, { documents: [document()] }); assert.equal(extracted.status, 200); assert.equal(extracted.headers.get("cache-control"), "no-store"); assert.equal((await extracted.json()).result.candidates.length, 1);
  await setTaxonomy(); state.respond = () => ({ suggestions: [{ tag: "x", domain: "合成领域" }] });
  assert.equal((await send(taxonomyRoute, { items: [{ tag: "x" }] })).status, 200);
  for (const route of [extractionRoute, taxonomyRoute]) {
    assert.equal((await send(route, {})).status, 400);
    assert.equal((await route(new Request("http://localhost", { method: "POST", body: "{" }))).status, 400);
    let canceled = false;
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } });
    assert.equal((await route(new Request("http://localhost", { method: "POST", body: stream, duplex: "half" }))).status, 413); assert.equal(canceled, true);
  }
  delete process.env.CHAT_API_KEY;
  assert.equal((await send(extractionRoute, { documents: [document()] })).status, 503);
  assert.equal((await send(taxonomyRoute, { items: [{ tag: "x" }] })).status, 503);
  const failedRoute = await load("../app/api/notes/candidates/route.ts", { "@/lib/notes-store": { listStudyNotes: async () => { throw new Error("private /path/secret"); } } });
  const failure = await send(failedRoute, { documents: [document()] }); assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /private|\/path/);
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { StudyLogStore } from "../src/log-store.mjs";
import { buildSectionChunks } from "../src/retrieval-core.mjs";
const store = new StudyLogStore(path.resolve("synthetic-source"), { indexRoot: path.resolve("synthetic-index") });
const file = { fileName: "2024_学习日志.md", filePath: path.resolve("synthetic-source/2024_学习日志.md") };
test("mixed source date spellings retain day bodies and correct citation dates", () => {
  const a="## 2024-1-3\r\n\r\n### 1. Alpha\r\nfirst\r\n\r\n", b="## 2024-01-4\r\n\r\n### 1. Beta\r\nsecond\r\n\r\n", c="## 2024-2-9\n\npreamble\n\n### 1. Gamma\nlast";
  const blocks=store.parseBlocks("# year\r\n\r\n"+a+b+c,file);
  assert.deepEqual(blocks.map(block=>block.date),["2024-01-03","2024-01-04","2024-02-09"]);
  assert.deepEqual(blocks.map(block=>block.content),[a.trimEnd(),b.trimEnd(),c]);
  const chunks=buildSectionChunks(blocks);
  assert.deepEqual(chunks.map(chunk=>[chunk.date,chunk.headingIndex]),[["2024-01-03",0],["2024-01-04",0],["2024-02-09",null],["2024-02-09",0]]);
  assert.equal(chunks.find(chunk=>chunk.heading===null).text,"preamble");
  assert.ok(chunks.every(chunk=>chunk.embeddingText.startsWith(chunk.date)));
  assert.ok(!chunks[0].text.includes("second"));
});
test("code examples and nested headings cannot steal a day or disappear from chunks", () => {
  const source="## 2024-3-1\n\n~~~~md\n~~~\n## 2024-3-1\n## 2024-3-2\n### Fake\n~~~~\n\n> ## 2024-3-3\n\n- ## 2024-3-4\n\n    ## 2024-3-5\n\n## 2024-3-6\n\nend";
  const blocks=store.parseBlocks(source,file);
  assert.deepEqual(blocks.map(block=>block.date),["2024-03-01","2024-03-06"]);
  const chunks=buildSectionChunks([blocks[0]]);
  assert.ok(chunks.every(chunk=>chunk.heading===null));
  const text=chunks.map(chunk=>chunk.text).join("\n");
  for(const day of [1,2,3,4,5]) assert.ok(text.includes("## 2024-3-"+day));
  assert.ok(!text.includes("2024-3-6"));
});
test("source normalization rejects invalid calendar days", () => {
  for(const date of ["2023-2-29","2024-2-30","2024-0-1","2024-13-1"]) assert.throws(()=>store.parseBlocks("## "+date+"\ninvalid",file),/invalid calendar date/);
  assert.equal(store.parseBlocks("## 2024-2-29\nleap",file)[0].date,"2024-02-29");
});

test('canonical-equivalent source dates cannot silently select the first occurrence', () => {
  assert.throws(() => store.parseBlocks('## 2024-1-3\nfirst\n\n## 2024-01-03\nsecond',file),/Duplicate day dates/);
});

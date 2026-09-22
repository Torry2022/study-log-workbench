import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { retrieveStudyLogContexts } from "../lib/mcp-client.ts";
import { startHttpServer } from "../../study-log-mcp/src/http-server.mjs";

test("Web SDK auto negotiation reads actual public MCP raw logs including a headingless preamble", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-rag-mcp-"));
  let service;
  try {
    const logRoot = path.join(root, "data"); await fs.mkdir(logRoot);
    await fs.writeFile(path.join(logRoot, ".instance.json"), JSON.stringify({ schemaVersion: 1, id: randomUUID() }));
    const original = "## 2026-08-01\n\nSyntheticPreamble evidence.\n\n### 合成主题\n\nSyntheticHeading other evidence.\n";
    await fs.writeFile(path.join(logRoot, "2026-08_学习日志.md"), original);
    service = await startHttpServer({ logRoot, indexRoot: path.join(root, "index"), token: "synthetic-integration-token", port: 0, retrieval: { embedding: { apiKey: "", apiUrl: "", model: "" }, reranker: { apiKey: "", apiUrl: "", model: "" }, rerankEnabled: false } });
    const config = { url: `http://127.0.0.1:${service.address.port}/mcp`, token: "synthetic-integration-token" };
    const preamble = await retrieveStudyLogContexts("SyntheticPreamble", { strategy: "relevance", matchMode: "literal", literalQuery: "SyntheticPreamble" }, undefined, config);
    assert.equal(preamble.contexts.length, 1); assert.equal(preamble.contexts[0].heading, null); assert.equal(preamble.contexts[0].headingIndex, null); assert.match(preamble.contexts[0].contentHash, /^[a-f0-9]{64}$/);
    const section = await retrieveStudyLogContexts("SyntheticHeading", { strategy: "comparison", matchMode: "literal", literalQuery: "SyntheticHeading", maxChunks: 12, maxChars: 18000 }, undefined, config);
    assert.equal(section.contexts[0].heading, "合成主题"); assert.equal(section.contexts[0].headingIndex, 0); assert.equal(section.retrieval.mode, "literal");
    assert.equal(await fs.readFile(path.join(logRoot, "2026-08_学习日志.md"), "utf8"), original);
    await assert.rejects(fs.stat(path.join(root, "index")), { code: "ENOENT" });
  } finally {
    await service?.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("workbench-rag-mcp-"));
    await fs.rm(root, { recursive: true, force: true });
  }
});

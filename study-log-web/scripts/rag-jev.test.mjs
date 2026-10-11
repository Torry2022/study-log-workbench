import test from "node:test";
import assert from "node:assert/strict";
import { jevConfiguration, judgeEvidence } from "../lib/rag-jev.ts";

test("Jev provider explicitly selects its credential and rejects unknown providers", () => {
  assert.equal(jevConfiguration({ AI_GATEWAY_API_KEY: "gateway" }), undefined);
  assert.equal(jevConfiguration({ RAG_JEV_PROVIDER: "other", TYPESAFE_API_KEY: "direct" }), undefined);
  assert.deepEqual(jevConfiguration({ RAG_JEV_PROVIDER: "vercel", AI_GATEWAY_API_KEY: "gateway", TYPESAFE_API_KEY: "direct" }), { provider: "vercel", apiKey: "gateway" });
  assert.deepEqual(jevConfiguration({ TYPESAFE_API_KEY: "direct" }), { provider: "typesafe", apiKey: "direct" });
});

test("Vercel TypeSafe adapter uses gateway and does not retry denied requests", async () => {
  let calls = 0;
  await assert.rejects(judgeEvidence("test", [], new AbortController().signal, "synthetic", async (url, init) => {
    calls++;
    assert.ok(String(url).startsWith("https://ai-gateway.vercel.sh/typesafe/"));
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic");
    assert.equal(JSON.parse(init.body).model, "typesafe-ai/jev");
    return Response.json({ error: { message: "Paid credits required" } }, { status: 403 });
  }, "vercel"));
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { clientUuid, consumeRagStream } from "../lib/rag-client.ts";

const encode = new TextEncoder();
function stream(text, size = 7) {
  const bytes = encode.encode(text); let offset = 0;
  return new ReadableStream({ pull(controller) { if (offset >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset + size)); offset += size; } });
}
const frame = (kind, data) => `event: ${kind}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
test("client identifiers work without crypto.randomUUID and retain UUID v4 bits", () => {
  const ids = Array.from({ length: 50 }, clientUuid);
  assert.equal(new Set(ids).size, 50);
  assert.ok(ids.every(id => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)));
});
test("split UTF8 and CRLF frames complete only on validated done", async () => {
  const events = [];
  await consumeRagStream(stream(frame("status", { message: "正在回答" }) + frame("delta", { text: "学习" }) + frame("done", { answer: "学习日志", citations: [] }), 1), new AbortController().signal, event => events.push(event));
  assert.deepEqual(events.map(event => event.kind), ["status", "delta", "done"]);
  assert.equal(events.at(-1).answer, "学习日志");
});
test("EOF without a complete done frame preserves partial output but never declares completion", async () => {
  const events = [];
  await assert.rejects(consumeRagStream(stream(frame("delta", { text: "部分回答" }) + 'event: done\ndata: {"answer":'), new AbortController().signal, event => events.push(event)), /提前结束/);
  assert.equal(events[0].text, "部分回答"); assert.equal(events.length, 1);
});
test("invalid citation or error event cannot be saved as a complete answer", async () => {
  for (const input of [frame("done", { answer: "回答", citations: [{}] }), frame("error", { message: "检索失败" })]) {
    const events = [];
    await assert.rejects(consumeRagStream(stream(input), new AbortController().signal, event => events.push(event)));
    assert.equal(events.length, 0);
  }
});
test("abort cancels a pending stream read instead of waiting for EOF", async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const result = consumeRagStream(body, controller.signal, () => {}); controller.abort();
  await assert.rejects(result, error => error.name === "AbortError"); assert.equal(cancelled, true);
});

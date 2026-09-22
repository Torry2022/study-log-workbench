import test from "node:test";
import assert from "node:assert/strict";
import { requestJson, cancelWorkspaceRequests, AUTH_EXPIRED_EVENT } from "../lib/client-http.ts";

test("late responses cannot resolve into a new authentication session", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; cancelWorkspaceRequests(); });
  let release;
  // Even an upstream transport ignoring cancellation must not publish old data.
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = requestJson("/api/fixture");
  cancelWorkspaceRequests();
  release(new Response(JSON.stringify({ value: "previous-session" })));
  await assert.rejects(pending, error => error.name === "AbortError");
  globalThis.fetch = async () => new Response(JSON.stringify({ value: "current-session" }));
  assert.deepEqual(await requestJson("/api/fixture"), { value: "current-session" });
});

test("expired authentication notifies the workspace and preserves the 401 error", async t => {
  const original = globalThis.fetch;
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.fetch = original; globalThis.window = previousWindow; cancelWorkspaceRequests(); });
  globalThis.window = new EventTarget();
  let events = 0;
  window.addEventListener(AUTH_EXPIRED_EVENT, () => { events++; cancelWorkspaceRequests(); });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  await assert.rejects(requestJson("/api/fixture"), error => error.status === 401);
  assert.equal(events, 1);
});

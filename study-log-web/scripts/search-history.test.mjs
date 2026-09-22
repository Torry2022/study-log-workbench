import test from "node:test";
import assert from "node:assert/strict";
import { readSearchHistory, clearSearchSessionHistory, SEARCH_HISTORY_STORAGE_KEY, SEARCH_HISTORY_LIMIT } from "../hooks/use-search-history.ts";

test("history survives reads, remains bounded, and does not import the old application's key", t => {
  const previous = globalThis.window;
  const data = new Map([["study-log-search-history", '["legacy synthetic term"]']]);
  const events = new EventTarget();
  globalThis.window = {
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
    dispatchEvent: event => events.dispatchEvent(event)
  };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  assert.deepEqual(readSearchHistory(), []);
  const terms = [null, 42, "", "  Alpha  ", "Alpha", ...Array.from({ length: 10 }, (_, i) => `合成搜索${i}`)];
  data.set(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(terms));
  const expected = ["Alpha", ...Array.from({ length: 7 }, (_, i) => `合成搜索${i}`)];
  assert.equal(SEARCH_HISTORY_LIMIT, 8);
  assert.deepEqual(readSearchHistory(), expected);
  assert.deepEqual(readSearchHistory(), expected);
  let cleared = 0;
  events.addEventListener("study-log:search-history-cleared", () => cleared++);
  clearSearchSessionHistory();
  assert.equal(cleared, 1);
  assert.deepEqual(readSearchHistory(), []);
  assert.equal(data.has(SEARCH_HISTORY_STORAGE_KEY), false);
  assert.equal(data.has("study-log-search-history"), true);
});

test("corrupt or blocked browser storage cannot disable search or explicit logout", t => {
  const previous = globalThis.window;
  const events = new EventTarget();
  let value = "{invalid-json";
  globalThis.window = { localStorage: { getItem: () => value }, dispatchEvent: event => events.dispatchEvent(event) };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  assert.deepEqual(readSearchHistory(), []);
  value = '{"unexpected":"object"}'; assert.deepEqual(readSearchHistory(), []);
  value = JSON.stringify(["x".repeat(501), "valid synthetic term"]);
  assert.deepEqual(readSearchHistory(), ["valid synthetic term"]);
  Object.defineProperty(window, "localStorage", { get() { throw new Error("synthetic disabled storage"); } });
  assert.deepEqual(readSearchHistory(), []);
  assert.doesNotThrow(clearSearchSessionHistory);
});

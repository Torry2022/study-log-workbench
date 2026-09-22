import test from "node:test";
import assert from "node:assert/strict";
import { ragSessionGroup, ragUpdatedLabel } from "../lib/rag-history-view.ts";

test("history groups follow Shanghai midnight across year boundaries", () => {
  const now = new Date("2026-12-31T16:05:00Z");
  assert.equal(ragSessionGroup("2026-12-31T16:00:00Z", now), "今天");
  assert.equal(ragSessionGroup("2026-12-31T15:59:59Z", now), "昨天");
  assert.equal(ragSessionGroup("2026-12-25T00:00:00+08:00", now), "近7天");
  assert.equal(ragSessionGroup("2026-12-24T23:59:59+08:00", now), "更早");
});

test("history labels use the same fixed timezone as its groups", () => {
  const now = new Date("2026-12-31T16:05:00Z");
  assert.equal(ragUpdatedLabel("2026-12-31T16:00:00Z", now), "00:00");
  assert.equal(ragUpdatedLabel("2026-12-31T15:59:59Z", now), "12-31");
});

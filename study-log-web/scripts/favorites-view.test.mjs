import assert from "node:assert/strict";
import test from "node:test";
import { filterFavorites } from "../lib/favorites-view.ts";

const favorite = (id, date, saved, groups, extra = {}) => ({
  id, date, month: date.slice(0, 7), createdAt: saved, updatedAt: saved, groupIds: groups,
  headingText: `小节 ${id}`, headingId: id, resolvedHeadingId: id, level: 3,
  sectionPreview: "", sectionSearchText: "", exists: true, ...extra
});
const all = { group: "all", month: "all", query: "", ignoreCase: true, headingsOnly: false, sort: "log-date" };
const items = [favorite("a", "2026-06-11", "2026-08-02", ["one", "two"]), favorite("b", "2026-07-12", "2026-08-01", []), favorite("c", "2026-06-11", "2026-08-03", ["two"], { exists: false, resolvedHeadingId: null })];

test("log-date and saved-date ordering differ and never reorder the owned snapshot", () => {
  assert.deepEqual(filterFavorites(items, all).map(item => item.id), ["b", "c", "a"]);
  assert.deepEqual(filterFavorites(items, { ...all, sort: "saved-date" }).map(item => item.id), ["c", "a", "b"]);
  assert.deepEqual(items.map(item => item.id), ["a", "b", "c"]);
});
test("group and month intersect while ungrouped excludes every assigned favorite", () => {
  assert.deepEqual(filterFavorites(items, { ...all, group: "two", month: "2026-06" }).map(item => item.id), ["c", "a"]);
  assert.deepEqual(filterFavorites(items, { ...all, group: "ungrouped" }).map(item => item.id), ["b"]);
  assert.equal(filterFavorites(items, { ...all, group: "one", month: "2026-07" }).length, 0);
});
test("search respects title-only and case flags while searching full section text", () => {
  const records = [favorite("d", "2026-06-01", "2026-08-01", [], { headingText: "HTTP 复习", sectionPreview: "概要", sectionSearchText: "正文中的 AbortController" })];
  assert.equal(filterFavorites(records, { ...all, query: " abortcontroller " }).length, 1);
  assert.equal(filterFavorites(records, { ...all, query: "abortcontroller", ignoreCase: false }).length, 0);
  assert.equal(filterFavorites(records, { ...all, query: "AbortController", headingsOnly: true }).length, 0);
  assert.equal(filterFavorites(records, { ...all, query: "HTTP", headingsOnly: true }).length, 1);
});
test("unresolved source headings remain visible and removable", () => {
  const result = filterFavorites(items, { ...all, query: "小节 c" });
  assert.equal(result.length, 1); assert.equal(result[0].exists, false);
  assert.equal(result[0].date, "2026-06-11"); assert.equal(result[0].headingId, "c");
});

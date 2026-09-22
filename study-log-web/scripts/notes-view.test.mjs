import test from "node:test";
import assert from "node:assert/strict";
import { localDateTimeInput, noteToDraft, draftFingerprint, filterNotes, buildFacets, mapNoteInsertion, mergeSavedNote } from "../lib/notes-view.ts";
const note = (id, overrides = {}) => ({ id, title: id, body: "正文", insight: "心得", sources: ["普通来源"], tags: ["网络"], recordedAt: "2026-08-01T12:00:00+08:00", createdAt: "2026-08-01T04:00:00Z", updatedAt: "2026-08-01T04:00:00Z", year: "2026", version: "v1", displayTitle: id, ...overrides });
test("Shanghai input stays fixed across UTC midnight and host timezone", () => {
  assert.equal(localDateTimeInput(new Date("2026-08-01T16:02:10Z")), "2026-08-02T00:02");
});
test("notes intersect year, tag and source/insight query, newest update first without mutating data", () => {
  const notes = [note("a"), note("b", { insight: "HTTP 判断", updatedAt: "2026-08-02T00:00:00Z" }), note("c", { year: "2025" })];
  assert.deepEqual(filterNotes(notes, "2026", "网络", "http").map(n => n.id), ["b"]);
  assert.deepEqual(filterNotes(notes, "all", "all", "普通来源").map(n => n.id), ["b", "a", "c"]);
  assert.deepEqual(notes.map(n => n.id), ["a", "b", "c"]);
  assert.deepEqual(buildFacets(notes, "year"), [{ value: "2026", count: 2 }, { value: "2025", count: 1 }]);
});
test("a save response preserves typing made during save and promotes new draft to versioned update", () => {
  const submitted = { ...noteToDraft(note("")), baseVersion: null };
  const current = { ...submitted, body: "提交后继续写", insight: "独立心得" };
  const saved = note("new-id", { version: "v2" });
  const merged = mergeSavedNote(submitted, current, saved);
  assert.equal(merged.keepEditor, true); assert.equal(merged.draft.body, current.body);
  assert.equal(merged.draft.insight, current.insight); assert.equal(merged.draft.id, "new-id"); assert.equal(merged.draft.baseVersion, "v2");
  assert.notEqual(draftFingerprint(merged.draft), merged.baseline);
  assert.equal(mergeSavedNote(submitted, submitted, saved).keepEditor, false);
});
test("upload cursor maps continued typing at its position and insertions before the selected text", () => {
  assert.deepEqual(mapNoteInsertion({ field: "body", from: 2, to: 2, valid: true }, "ab", "abcd"), { field: "body", from: 4, to: 4, valid: true });
  assert.deepEqual(mapNoteInsertion({ field: "insight", from: 2, to: 4, valid: true }, "abcdxx", "!abcdxx"), { field: "insight", from: 3, to: 5, valid: true });
});
test("upload mapping refuses replacement of changed original selection and stays invalid after further input", () => {
  const changed = mapNoteInsertion({ field: "body", from: 2, to: 4, valid: true }, "abcdxx", "abCDxx");
  assert.equal(changed.valid, false); assert.equal(mapNoteInsertion(changed, "abCDxx", "abCDxx!").valid, false);
  assert.equal(mapNoteInsertion({ field: "body", from: 3, to: 3, valid: true }, "abcdef", "abef").valid, false);
});
test("typing at selection boundaries preserves original selection while typing within it invalidates", () => {
  const selection = { field: "body", from: 2, to: 4, valid: true };
  assert.deepEqual(mapNoteInsertion(selection, "abcdef", "ab!cdef"), { ...selection, from: 3, to: 5 });
  assert.deepEqual(mapNoteInsertion(selection, "abcdef", "abcd!ef"), selection);
  assert.equal(mapNoteInsertion(selection, "abcdef", "abc!def").valid, false);
});

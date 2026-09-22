import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthCalendar, recordedDates, shiftMonth } from "../lib/date-jump.ts";

test("calendar is Monday-first, handles leap years, and never invents invalid dates", () => {
  assert.equal(buildMonthCalendar("2024-02").filter(Boolean).length, 29);
  assert.equal(buildMonthCalendar("2025-02").filter(Boolean).length, 28);
  assert.deepEqual(buildMonthCalendar("2024-01").slice(0, 2), ["2024-01-01", "2024-01-02"]);
  assert.deepEqual(buildMonthCalendar("2026-02").slice(0, 7), [null, null, null, null, null, null, "2026-02-01"]);
  assert.equal(buildMonthCalendar("0096-02").filter(Boolean).length, 29);
  assert.deepEqual(buildMonthCalendar("2026-13"), []);
  assert.deepEqual(buildMonthCalendar("invalid"), []);
});

test("month navigation crosses year boundaries without the Date constructor year-99 trap", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("0099-12", 1), "0100-01");
  assert.throws(() => shiftMonth("2026-13", 1));
  assert.throws(() => shiftMonth("0000-01", -1));
  assert.throws(() => shiftMonth("9999-12", 1));
});

test("selectable dates come exclusively from a validated matching-month response", () => {
  assert.deepEqual([...recordedDates([{ date: "2026-02-02" }, { date: "2026-02-02" }, { date: "2026-02-20" }], "2026-02")], ["2026-02-02", "2026-02-20"]);
  assert.equal(recordedDates([], "2026-02").size, 0);
  for (const rows of [undefined, {}, [null], [{ date: "2026-02-30" }], [{ date: "2026-03-01" }], [{ date: 1 }]]) {
    assert.throws(() => recordedDates(rows, "2026-02"));
  }
});

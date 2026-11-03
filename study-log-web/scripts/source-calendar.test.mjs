import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDay, listDays, listMonths, saveDay, deleteDay, extractDayBlockFromSource } from "../lib/log-store.ts";
import { normalizeDayContent, toEditableDayBody } from "../lib/day-content.ts";
import { isValidLogDate } from "../lib/study-date.ts";
import { getMonthlyStats } from "../lib/stats-store.ts";
import { buildMarkdownOutline } from "../lib/markdown-outline.ts";

const first = "# 年度\r\n\r\n## 2024-1-3\r\n\r\n### 1. Alpha\r\n\r\nfirst\r\n\r\n";
const middle = "## 2024-01-4\r\n\r\n### 1. Beta\r\n\r\nsecond\r\n\r\n";
const last = "## 2024-2-9\r\n\r\n### 1. Gamma\r\n\r\nlast\r\n";
const original = first + middle + last;
async function syntheticSource(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-calendar-test-"));
  const before = { LOG_ROOT: process.env.LOG_ROOT, BACKUP_ROOT: process.env.BACKUP_ROOT };
  process.env.LOG_ROOT = root; process.env.BACKUP_ROOT = path.join(root, ".backups");
  t.after(async () => {
    for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("source-calendar-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, "2024_学习日志.md");
  await fs.writeFile(file, original);
  return { root, file };
}
test("source spelling normalizes metadata without changing Markdown boundaries", async t => {
  const { file } = await syntheticSource(t);
  assert.deepEqual((await listMonths()).map(item => [item.id, item.dayCount]), [["2024-02",1],["2024-01",2]]);
  assert.deepEqual((await listDays("2024-01")).map(item => item.date), ["2024-01-04","2024-01-03"]);
  assert.equal((await getDay("2024-01-04")).content, middle.trimEnd());
  assert.equal(extractDayBlockFromSource(original, "2024_学习日志.md", "2024-02-09"), last.trimEnd());
  assert.equal(toEditableDayBody("2024-01-04", middle), "### 1. Beta\r\n\r\nsecond");
  assert.equal(normalizeDayContent("2024-01-04", middle), "## 2024-01-04\n\n### 1. Beta\r\n\r\nsecond");
  assert.deepEqual(buildMarkdownOutline(middle).map(item => item.text), ["1. Beta"]);
  const stats = await getMonthlyStats("2024-01");
  assert.equal(stats.dayCount, 2); assert.equal(stats.topicCount, 2);
  assert.equal(await fs.readFile(file, "utf8"), original);
  assert.equal(isValidLogDate("2024-1-4"), false);
  await assert.rejects(getDay("2024-1-4"));
});
test("saving and deleting a non-padded day retain neighboring headings and body bytes", async t => {
  const { file } = await syntheticSource(t);
  const neighbors = await Promise.all([getDay("2024-01-03"), getDay("2024-02-09")]);
  const day = await getDay("2024-01-04");
  await saveDay({ date: day.date, baseVersion: day.version, content: "### 1. Beta\n\nupdated", mode: "replace" });
  const changed = await fs.readFile(file, "utf8");
  assert.ok(changed.startsWith(first)); assert.ok(changed.includes(last.trimEnd()));
  assert.equal((changed.match(/^## 2024-01-04$/gm) || []).length, 1);
  const saved = await getDay("2024-01-04");
  await deleteDay({ date: saved.date, baseVersion: saved.version });
  for (const neighbor of neighbors) assert.equal((await getDay(neighbor.date)).content, neighbor.content);
});
test("only real root headings delimit days and invalid calendars remain errors", () => {
  const content = "## 2024-3-1\n\n~~~md\n## 2024-3-2\n~~~\n\n> ## 2024-3-3\n\n- ## 2024-3-4\n\n    ## 2024-3-5\n\n## 2024-3-6\n\nend";
  const body = extractDayBlockFromSource(content, "2024_学习日志.md", "2024-03-01");
  for (const day of [2,3,4,5]) assert.ok(body.includes("2024-3-"+day));
  assert.ok(!body.includes("2024-3-6"));
  for (const date of ["2023-2-29","2024-2-30","2024-0-1","2024-13-1"]) {
    assert.throws(() => extractDayBlockFromSource("## "+date+"\n\ninvalid", "2024_学习日志.md", "2024-01-01"), /无效日期/);
  }
});

test('canonical-equivalent source dates cannot silently select the first occurrence', () => {
  assert.throws(() => extractDayBlockFromSource('## 2024-1-3\nfirst\n\n## 2024-01-03\nsecond','2024_学习日志.md','2024-01-03'),/重复日期/);
});

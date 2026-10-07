import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getDay, listMonths, listDays } from "../lib/log-store.ts";
import { buildMarkdownOutline } from "../lib/markdown-outline.ts";
import { searchDayContents } from "../lib/log-search.ts";
import { parseStatsDays } from "../lib/stats-store.ts";

test("day summaries retain unnumbered H3 headings and share section order with navigation, search and statistics", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-read-test-"));
  const old = process.env.LOG_ROOT; process.env.LOG_ROOT = root;
  t.after(async () => {
    if (old === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = old;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-read-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const content = ["## 2026-01-15", "", "### 未编号小节", "合成资料", "#### 内部标题", "",
    "```md", "### 代码中的标题", "```", "", "> ### 引用标题", "", "- 列表", "  ### 嵌套标题", "",
    "### 2. 编号小节", "合成资料", "", "### 3D 与 HTTP/2", "合成资料", ""].join("\n");
  const fileName = "2026-01_学习日志.md", file = path.join(root, fileName);
  await fs.writeFile(file, content);
  const [summary] = await listDays("2026-01");
  const expected = ["未编号小节", "编号小节", "3D 与 HTTP/2"];
  assert.deepEqual(summary.headings, expected);
  const sections = buildMarkdownOutline(content).filter(heading => heading.level === 3);
  assert.deepEqual(sections.map(heading => heading.text.replace(/^\d+\.\s+/, "")), summary.headings);
  const blocks = [{ date: summary.date, content, fileName }];
  assert.deepEqual(searchDayContents(blocks, "合成资料")[0].headings, summary.headings);
  assert.deepEqual(parseStatsDays(blocks)[0].headings.map(heading => [heading.headingIndex, heading.headingText]), expected.map((text, index) => [index, text]));
  assert.equal(await fs.readFile(file, "utf8"), content);
});

test("reads mixed yearly/monthly sources without changing bytes or extracting fenced headings", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-read-test-"));
  const old = process.env.LOG_ROOT; process.env.LOG_ROOT = root;
  t.after(async () => {
    if (old === undefined) delete process.env.LOG_ROOT; else process.env.LOG_ROOT = old;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("workbench-read-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.deepEqual(await listMonths(), []);
  const yearly = "## 2025-12-31\n\n### 1. 年度样本\n\n合成内容\n";
  const monthly = "## 2026-01-15\n\n### 1. 并发控制\n\n```md\n## 2026-01-16\n### 2. 代码里的标题\n```\n\n---\n\n## 2026-01-17\n\n### 1. 重复标题\n\n合成内容\n";
  await fs.writeFile(path.join(root, "2025_学习日志.md"), yearly);
  await fs.writeFile(path.join(root, "2026-01_学习日志.md"), monthly);
  await fs.writeFile(path.join(root, "unrelated.md"), "## 2026-02-01\n\n忽略这个文件");
  assert.deepEqual((await listMonths()).map(m => [m.id, m.dayCount]), [["2026-01", 2], ["2025-12", 1]]);
  const days = await listDays("2026-01");
  assert.deepEqual(days.map(d => d.date), ["2026-01-17", "2026-01-15"]);
  assert.deepEqual(days[1].headings, ["并发控制"]);
  const day = await getDay("2026-01-15");
  assert.ok(day.exists); assert.ok(day.version); assert.match(day.content, /代码里的标题/);
  assert.equal((await getDay("2026-01-16")).exists, false);
  assert.deepEqual(await listDays("2026-02"), []);
  await assert.rejects(getDay("2026-02-30"), /Invalid date/);
  await assert.rejects(listDays("2026-13"), /Invalid month/);
  assert.equal(await fs.readFile(path.join(root, "2025_学习日志.md"), "utf8"), yearly);
  assert.equal(await fs.readFile(path.join(root, "2026-01_学习日志.md"), "utf8"), monthly);
  const readFile = fs.readFile;
  let replaced = false;
  try {
    fs.readFile = async (...args) => {
      const value = await readFile(...args);
      if (!replaced && args[0] === path.join(root, "2026-01_学习日志.md")) {
        replaced = true;
        await fs.writeFile(args[0], monthly.replace("并发控制", "外部更新"));
      }
      return value;
    };
    const snapshot = await getDay("2026-01-15");
    assert.match(snapshot.content, /并发控制/);
    assert.ok(snapshot.version.endsWith(crypto.createHash("sha1").update(monthly).digest("hex").slice(0, 16)));
  } finally { fs.readFile = readFile; }
  await fs.writeFile(path.join(root, "2026-01_学习日志.md"), monthly);
  await fs.writeFile(path.join(root, "2026_学习日志.md"), "## 2026-01-15\n\n另一份日块");
  await assert.rejects(getDay("2026-01-15"), /重复日期/);
  await assert.rejects(listMonths(), /重复日期/);
  await fs.writeFile(path.join(root, "2026_学习日志.md"), "## 2026-02-30\n\n无效日期");
  await assert.rejects(listMonths(), /无效日期/);
  await fs.writeFile(path.join(root, "2026_学习日志.md"), "## 2025-12-31\n\n错误归属");
  await assert.rejects(listMonths(), /年月不一致/);
});

import fs from "node:fs/promises";
import path from "node:path";
import { initialize, withInstanceLock } from "./instance.mjs";

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("Provide an absolute NEW synthetic instance directory");
await initialize(root);
const data = path.join(root, "data");
await withInstanceLock(data, async () => {
  const fence = "```";
  const january = [
    "## 2026-01-15", "", "### 1. 并发控制", "", "这是用于验收的合成学习资料。**状态必须与当前请求对应。**", "",
    `${fence}markdown`, "## 2026-01-16", "### 2. 代码中的示例标题", fence, "",
    "公式：$a^2+b^2=c^2$。", "", "$$", "E=mc^2", "$$", "",
    "| 操作 | 结果 |", "| --- | --- |", "| 读取 | 原文保持 |", "",
    `${fence}mermaid`, "flowchart LR", "  A[读取] --> B[校验] --> C[呈现]", fence, "",
    "![合成示意图](assets/demo.svg)", "", "[[2026-02-05#1. 并发控制|查看二月记录]]", "",
    "### 2. 同名小节", "", "第一处内容。", "", "### 2. 同名小节", "", "第二处内容。", "",
    ...Array.from({ length: 18 }, (_, i) => `合成长文段落 ${i + 1}：用于检验阅读滚动、返回定位与窄屏排版。\n`),
    "---", "", "## 2026-01-17", "", "### 1. 文件版本", "", "读取与版本应来自相同快照。", ""
  ].join("\n");
  await fs.writeFile(path.join(data, "2026-01_学习日志.md"), january, { flag: "wx" });
  await fs.writeFile(path.join(data, "2026-02_学习日志.md"), "## 2026-02-05\n\n### 1. 并发控制\n\n跨月合成资料。\n", { flag: "wx" });
  await fs.writeFile(path.join(data, "2025_学习日志.md"), "## 2025-12-31\n\n### 1. 年度样本\n\n年度文件合成资料。\n", { flag: "wx" });
  await fs.mkdir(path.join(data, "assets"), { recursive: true });
  await fs.writeFile(path.join(data, "assets/demo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160"><rect width="480" height="160" fill="#faf9f5"/><rect x="30" y="50" width="160" height="60" rx="8" fill="#cc785c"/><path d="M200 80H280" stroke="#141413" stroke-width="3"/><rect x="290" y="50" width="160" height="60" rx="8" fill="#e8e0d2"/></svg>', { flag: "wx" });
  await fs.writeFile(path.join(data, "assets/broken.png"), "synthetic-invalid-image", { flag: "wx" });
});
console.log("Synthetic fixture created; no personal data used.");

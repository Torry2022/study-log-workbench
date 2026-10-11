import fs from 'node:fs/promises';
import path from 'node:path';

export const longContextQuestion = '为什么北辰的归档流程不能直接保存，最终要满足什么条件？';
export const longRangeQuestion = '比较2026年9月1日和9月18日的归档记录，说明为何不能直接保存和需要满足的条件';
export const linkedRules = '只有预览没有新增字段、来源路径与原记录一致，并且用户明确确认，才能保存。预览发现新增字段或来源路径不一致时不能保存；用户没有确认也不能保存。AI不能自动执行保存。';
export function longContextCorpus() {
  const observations = Array.from({ length: 480 }, (_, index) => JSON.stringify({ sample: index + 1, trace: `observation-${String(index).padStart(4, '0')}`, duration: 23 + index % 11, result: 'preview-only', saved: false })).join('\n');
  return `## 2026-09-01\n\n### 北辰归档记录\n\n北辰完成了归档预览，但不能直接保存。保存前的完整条件另有专门规则，规则名称记在本文末尾。以下是过程采样，不是审批结果。\n\n\`\`\`jsonl\n${observations}\n\`\`\`\n\n后续应查阅“河图检查规则”。只有按那份规则逐项满足要求，才允许完成归档；这里的 saved:false 只表示采样未写入，不表示已经确认。\n\n## 2026-09-18\n\n### 河图检查规则\n\n${linkedRules}\n`;
}
export async function writeLongContextCorpus(root) {
  if (!path.isAbsolute(root)) throw Error('NEW absolute synthetic corpus directory required');
  await fs.mkdir(root);
  const file = path.join(root, '2026-09_学习日志.md');
  await fs.writeFile(file, longContextCorpus(), { flag: 'wx' });
  const manifest = { files: [file], routes: ['baseline', 'agent'], reasoningEffort: 'none', cases: [1, 2].map(round => ({
    id: `long-linked-${round}`, question: longContextQuestion, rubric: '应找到河图检查规则，保留无新增字段、来源路径一致、明确确认三项条件及不能自动保存；引用必须支持条件。' })) };
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  await fs.writeFile(path.join(root, 'range-manifest.json'), JSON.stringify({ ...manifest, cases: [1, 2].map(round => ({
    id: `fixed-range-${round}`, question: longRangeQuestion, rubric: '两日期完整读取；保留三项条件和否定，原文与规则引用分别支持结论。'
  })) }, null, 2), { flag: 'wx' });
  return manifestPath;
}

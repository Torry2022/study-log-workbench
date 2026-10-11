import fs from 'node:fs/promises';
import path from 'node:path';

// Synthetic holdout materials; fixed before model evaluation, separate from the long archive sample.
export const linkedCases = [
  {
    id: 'troubleshooting', date: '2026-08-04', ruleDate: '2026-08-12', rule: '映川重连说明',
    question: '为什么青岚排错记录没有立即重连，怎样才能继续？',
    content: '青岚排错时停在断连处。我没有立即重连，也没确认问题已经解决；下一步依照“映川重连说明”处理。',
    guidance: '先保留错误码，再核对目标地址。地址不一致时应停止；两项核对完成后可以重新建立连接。没有错误码时不能判断原因，不必等待用户额外批准重连。',
    rubric: '保留错误码、核对地址；地址不一致停止；没有错误码不能判断原因；无需额外批准，不得把归档确认条件移植过来。'
  },
  {
    id: 'reading', date: '2026-07-06', ruleDate: '2026-07-15', rule: '溪桥阅读方法',
    question: '为什么知澜读书笔记强调先闭书，这个方法有什么限制？',
    content: '知澜读书笔记里，我先闭书再写下记得的内容，并没有认为这能代替复习；方法的用法和限制另记在“溪桥阅读方法”。',
    guidance: '不看书复述可以暴露自己没有理解的地方，随后对照原文修正。此法适合检查概念理解；遇到不熟悉的专有名词仍需查证，不适合据此判断整本书已经掌握，也不能代替长期复习。',
    rubric: '闭书复述暴露理解缺口、对照原文修正；概念理解适用，陌生术语查证；不能据此认定全书掌握或替代长期复习。'
  }
];

export async function writeLinkedCases(root) {
  if (!path.isAbsolute(root)) throw Error('NEW absolute synthetic directory required');
  await fs.mkdir(root);
  const files = [];
  for (const entry of linkedCases) {
    const file = path.join(root, `${entry.date.slice(0, 7)}_学习日志.md`);
    await fs.writeFile(file, `## ${entry.date}\n\n### 实践记录\n\n${entry.content}\n\n## ${entry.ruleDate}\n\n### ${entry.rule}\n\n${entry.guidance}\n`, { flag: 'wx' });
    files.push(file);
  }
  const manifest = path.join(root, 'manifest.json');
  await fs.writeFile(manifest, JSON.stringify({ files, routes: ['baseline', 'agent'], reasoningEffort: 'none',
    cases: linkedCases.flatMap(entry => [1, 2].map(round => ({ id: `${entry.id}-${round}`, question: entry.question, rubric: entry.rubric }))) }, null, 2), { flag: 'wx' });
  return manifest;
}

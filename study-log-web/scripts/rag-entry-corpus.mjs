// Predetermined synthetic materials, including cases already answered by retrieval.
import fs from 'node:fs/promises';
import path from 'node:path';
import { longContextCorpus, linkedRules, longContextQuestion } from './rag-long-context-corpus.mjs';
import { linkedCases } from './rag-linked-cases.mjs';

export const entryQuestions = [longContextQuestion, '北辰归档流程可以直接保存吗？请给出最终保存条件。', '列出北辰归档流程完成保存所需的条件。'];
export const troubleshootingRule = '先保留错误码并核对目标地址。地址不一致时停止；缺少错误码时不能判断原因。核对完成后可以重连，不需要额外批准，但重连成功不表示原问题已解决。';
export async function writeEntryCorpus(root) {
  if (!path.isAbsolute(root)) throw Error('NEW absolute synthetic corpus directory required');
  await fs.mkdir(root);
  const observations = Array.from({length:480},(_,index)=>JSON.stringify({sample:index+1,connection:'interrupted',attemptedReconnect:false,trace:`connection-${index}`})).join('\n');
  const sources = {'2026-09_学习日志.md':longContextCorpus(), '2026-06_学习日志.md':`## 2026-06-03\n\n### 霁川连接排错\n\n霁川连接排错暂停在断连处，尚未重连。后续处理步骤在本条记录末尾指向另一篇说明，采样结果不能证明原问题已经解决。\n\n\`\`\`jsonl\n${observations}\n\`\`\`\n\n下一步按“南渡连接检查”核对，具体步骤记在该说明里。\n\n## 2026-06-16\n\n### 南渡连接检查\n\n${troubleshootingRule}\n`};
  for (const item of linkedCases) sources[`${item.date.slice(0,7)}_学习日志.md`]=`## ${item.date}\n\n### 实践记录\n\n${item.content}\n\n## ${item.ruleDate}\n\n### ${item.rule}\n\n${item.guidance}\n`;
  const files=[];
  for (const [name,content] of Object.entries(sources)) { const file=path.join(root,name); await fs.writeFile(file,content,{flag:'wx'}); files.push(file); }
  const groups = entryQuestions.map((question,index)=>({id:`phrasing-${index+1}`,question,rubric:`找出河图检查规则并保留全部条件和否定：${linkedRules}`}));
  groups.push({id:'troubleshooting-long',question:'列出霁川连接排错下一步要做的事，以及不能据此认定的结果。',rubric:troubleshootingRule});
  for (const item of linkedCases) groups.push({id:`sufficient-${item.id}`,question:item.question,rubric:item.rubric});
  groups.push({id:'complete-range',question:'比较2026年9月1日和9月18日的归档记录，说明保存前要满足的条件。',rubric:`两天完整覆盖，保留条件和否定：${linkedRules}`});
  const manifests=[];
  for(const group of groups){const file=path.join(root,`${group.id}-manifest.json`);await fs.writeFile(file,JSON.stringify({files,routes:['baseline','agent'],reasoningEffort:'none',cases:[1,2].map(round=>({...group,id:`${group.id}-${round}`}))},null,2),{flag:'wx'});manifests.push(file);}
  return {files,groups,manifests};
}

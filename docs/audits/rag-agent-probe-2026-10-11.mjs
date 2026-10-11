// Read-only diagnostic: only synthetic in-memory data. Prints current behavior, not expected correctness.
// Run from repository root: node --experimental-strip-types docs/audits/rag-agent-probe-2026-10-11.mjs
import { planRagRetrieval, needsSemanticRetrievalPlanning } from '../../study-log-web/lib/rag-retrieval-plan.ts';
import { KeywordRetriever } from '../../study-log-mcp/src/retrieval.mjs';
import { parseDayBlocks } from '../../study-log-mcp/src/markdown-source.mjs';
const block = (date, body) => parseDayBlocks(`## ${date}\n\n### 项目\n\n${body}`, `${date.slice(0, 7)}_学习日志.md`)[0];
const retriever = new KeywordRetriever();
const now = new Date('2026-10-11T04:00:00Z');
for (const [question, blocks] of [
  ['2026年9月的日志中哪里提到过`Agent`？', [block('2026-09-05', 'Agent 记录甲'), block('2026-10-05', 'Agent 记录乙')]],
  ['比较2026年9月和2026年10月的学习内容', [block('2026-09-05', '学习数据库'), block('2026-10-05', '学习缓存')]],
  ['总结2026年9月的学习内容', Array.from({length: 30}, (_, i) => block(`2026-09-${String(i + 1).padStart(2, '0')}`, `day${i + 1} unique subject ${i * i + 3} progress`))]
]) {
  const plan = planRagRetrieval(question, now);
  const result = await retriever.retrieveContexts(blocks, question, plan);
  console.log(JSON.stringify({question, plan, semanticPlanner: needsSemanticRetrievalPlanning(plan), dates: result.contexts.map(item => item.date), truncated: result.context.truncated}));
}
const question = '我记录过哪些关于2026年9月15日发布的模型的使用体验？';
const plan = planRagRetrieval(question, now);
console.log(JSON.stringify({question, plan, semanticPlanner: needsSemanticRetrievalPlanning(plan)}));

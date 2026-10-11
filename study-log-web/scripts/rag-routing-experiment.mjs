// Offline experiment only. No imports from application entrypoints, no data writes outside output.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { planRagRetrieval, needsSemanticRetrievalPlanning } from '../lib/rag-retrieval-plan.ts';

const options = {
  route: {
    search: '查找具体内容、概念或事实；不是汇总范围，也不是比较两方。',
    summary: '汇总一个或多个日期的记录，可逐日总结；不要求比较差异。',
    comparison: '比较两个时期或两个主题的差异、变化、异同；明确要求不比较时不选。',
    source: '追问上一轮已列出的某条来源，且上下文提供可用来源指针。',
    clarify: '缺少决定查什么所必需的指代或范围，现有上下文无法消除歧义。'
  },
  dates: {
    none: '问题没有用时间限制日志范围，也没有描述事件时间。',
    logs: '时间只用于限制要查的日志日期，包括单日、多日、月份；不计算日期。',
    events: '时间只描述材料中的事件或发布，不限制写日志的日期。',
    both: '同时有日志日期限制与事件时间，两者角色不同。',
    uncertain: '提到了时间范围，但缺少上下文，无法确定其角色或指向。'
  }
};

export function validateRouting(response) {
  const answers = response?.answers;
  if (!answers || Object.keys(answers).sort().join() !== 'dates,route') throw Error('Invalid routing fields');
  return Object.fromEntries(Object.entries(options).map(([name, values]) => {
    const answer = answers[name], keys = Object.keys(values).sort();
    if (answer?.type !== 'choice' || !keys.includes(answer.choice) ||
        !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
        !answer.probabilities || Object.keys(answer.probabilities).sort().join() !== keys.join() ||
        Object.values(answer.probabilities).some(p => !Number.isFinite(p) || p < 0 || p > 1) ||
        Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) > .01) throw Error('Invalid routing choice');
    return [name, answer.choice];
  }));
}

async function main() {
  const output = process.argv[2], live = process.argv.includes('--live');
  if (!output || !path.isAbsolute(output)) throw Error('New absolute output directory required');
  if (live && !process.env.TYPESAFE_API_KEY) throw Error('TYPESAFE_API_KEY required');
  const cases = JSON.parse(await fs.readFile(new URL('./rag-routing-cases.json', import.meta.url), 'utf8'));
  if (cases.length > 14) throw Error('Experiment limited to 28 requests');
  await fs.mkdir(output); // Refuse overwrite; expected results fixed before requests.
  await fs.writeFile(path.join(output, 'cases.json'), JSON.stringify(cases, null, 2));
  const rules = cases.map(c => {
    const plan = planRagRetrieval(c.question, new Date('2026-10-11T04:00:00Z'));
    return { id: c.id, plan, needsExistingModelPlanner: needsSemanticRetrievalPlanning(plan),
      entersPlannerWithoutHistory: /总结|回顾|比较|对比|阶段|期间|那几天|之前|之后/.test(c.question) && needsSemanticRetrievalPlanning(plan),
      note: 'Rule-stage observation only; history rewriting and existing model planning not executed.' };
  });
  await fs.writeFile(path.join(output, 'rules.json'), JSON.stringify(rules, null, 2));
  if (!live) return;
  const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY, baseURL: 'https://api.typesafe.ai',
    defaultModel: 'jev-1.13.0', logLevel: 'off', retry: { maxRetries: 0 }, timeout: 8000 });
  const results = [];
  // Second pass reverses choice ordering; no prompt tuning or retries on these cases.
  for (const reverse of [false, true]) for (const c of cases) {
    const started = Date.now();
    try {
      const ordered = values => Object.fromEntries(reverse ? Object.entries(values).reverse() : Object.entries(values));
      const response = await client.systemOne({ state: { question: c.question, context: c.context || '无先前对话。' }, questions: {
        route: choice('只判断当前问题需要哪种取证路径。上下文只用于消除指代；新问题不继承旧问题的范围。按用户最终明确要求选择，不回答问题。', ordered(options.route)),
        dates: choice('判断当前问题中时间表述的用途，不计算、比较或生成日期。忽略明确排除的日志日期限制。', ordered(options.dates))
      } }, { signal: AbortSignal.timeout(10000) });
      const decision = validateRouting(response);
      results.push({ id: c.id, reverse, elapsedMs: Date.now() - started, decision, usage: response.usage,
        pass: Object.keys(c.expected).every(key => c.expected[key] === decision[key]) });
    } catch {
      results.push({ id: c.id, reverse, elapsedMs: Date.now() - started, error: 'request_or_validation_failed' });
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
      throw Error('Experiment stopped after request/validation failure; no retry');
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ id: c.id, reverse, pass: results.at(-1).pass }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Routing experiment stopped; inspect redacted output and configuration.'); process.exitCode = 1; });

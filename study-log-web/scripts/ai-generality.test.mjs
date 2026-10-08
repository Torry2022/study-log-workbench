import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { contextualizeRagQuestion, planRagRetrievalWithFallback } from '../lib/rag-planning.ts';
import { buildRagMessages } from '../lib/rag-answer.ts';

test('nontechnical questions reach actual planning requests without a subject restriction', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body); requests.push(input.messages);
    const content = requests.length === 1 ? { query: '叙述者的判断为什么不等于作者的立场？' } : { strategy: 'relevance', dateFrom: null, dateTo: null };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const config = { apiKey: 'synthetic', model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/chat` };
  const query = await contextualizeRagQuestion('两者为什么不同？', [{ role: 'user', content: '叙述者与作者的立场' }], undefined, config);
  assert.equal(query, '叙述者的判断为什么不等于作者的立场？');
  assert.equal((await planRagRetrievalWithFallback(query, undefined, new Date('2026-10-08T01:00:00Z'), config)).planner, 'llm');
  assert.equal(requests.length, 2);
  for (const messages of requests) { assert.doesNotMatch(messages[0].content, /技术学习|计算机/); assert.match(messages[0].content, /不执行|不要回答/); }
  const contexts = [{ sourceId: 'S1', date: '2026-10-08', heading: '读书笔记', content: '叙述者的判断不等于作者的立场。' }];
  for (const mode of ['logs_only', 'logs_and_general']) {
    const messages = buildRagMessages(query, [], contexts, mode);
    assert.doesNotMatch(messages[0].content, /通用技术知识/);
    assert.match(JSON.stringify(messages), /叙述者的判断不等于作者的立场/);
    assert.match(messages[0].content, mode === 'logs_only' ? /不得使用外部知识/ : /通用知识不得使用来源编号/);
  }
});

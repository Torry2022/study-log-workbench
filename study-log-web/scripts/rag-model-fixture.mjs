import assert from 'node:assert/strict';

// A provider substitute must follow the real terminal-tool contract, not bypass it with text.
export function agentAssessmentFixture(answer, body = { messages: [] }) {
  const ids = [...new Set([...answer.matchAll(/\[([Ss]\d+)\]/g)].map(match => match[1].toUpperCase()))];
  const evidence = ids.map(sourceId => {
    const match = new RegExp(`\\[${sourceId}\\]\\n日志日期：[\\s\\S]*?\\n内容：\\n([\\s\\S]*?)\\n以上为\\[${sourceId}\\]`).exec(body.messages.at(-1)?.content || '');
    assert.ok(match, `Fixture answer must cite supplied ${sourceId}`);
    return { point: '合成问题的要点', sourceId, quote: match[1].slice(0, 80) };
  });
  const packet = delta => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
  const names = new Set((body.tools || []).map(tool => tool.function.name));
  const name = names.has('assess') ? 'assess' : 'reply';
  const args = name === 'assess' ? { assessment: answer, evidence, unresolved: [], next: 'finish' } : { answer, evidence };
  return new Response(packet({ content: '内部文本，不可送给用户。', tool_calls: [{ index: 0, id: name, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }) +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}

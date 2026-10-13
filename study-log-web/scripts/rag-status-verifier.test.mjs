import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRangeStatusVerdicts, extractRangeStatusClaims, rangeStatusVerificationEnabled,
  verifyRangeStatusClaims } from '../lib/rag-status-verifier.ts';

const draft = `## 项目甲

进展保持原样[S1]。

### 仍待解决

- 较早记录的问题仍存在[S1]。
- 月底仍未完成的事项[S2]。

## 项目乙

### 仍待解决

- 无法确定月底状态的事项[S3]。

## 其他

一般技术限制不应受影响[S4]。`;

test('status claims are extracted in document order and only from the exact heading', () => {
  assert.deepEqual(extractRangeStatusClaims(draft), [
    { claimId: 'C1', text: '较早记录的问题仍存在[S1]。' },
    { claimId: 'C2', text: '月底仍未完成的事项[S2]。' },
    { claimId: 'C3', text: '无法确定月底状态的事项[S3]。' }
  ]);
  assert.deepEqual(extractRangeStatusClaims('### 重要限制\n\n- 技术边界'), []);
  assert.deepEqual(extractRangeStatusClaims('## 仍待解决\n\n- 二级标题下的事项'), [{ claimId: 'C1', text: '二级标题下的事项' }]);
});

test('verdict application removes stale items and empty status sections without rewriting the answer', () => {
  const answer = applyRangeStatusVerdicts(draft, [
    { claimId: 'C1', text: '', verdict: 'outdated', sourceIds: ['S1'], reason: '后来修复' },
    { claimId: 'C2', text: '', verdict: 'supported', sourceIds: ['S2'], reason: '月底仍存在' },
    { claimId: 'C3', text: '', verdict: 'unclear', sourceIds: ['S3'], reason: '没有月底状态' }
  ]);
  assert.doesNotMatch(answer, /较早记录的问题|无法确定月底状态/);
  assert.match(answer, /### 仍待解决\n\n- 月底仍未完成的事项\[S2\]/);
  assert.equal((answer.match(/^### 仍待解决$/gm) || []).length, 1);
  assert.match(answer, /进展保持原样\[S1\]/);
  assert.match(answer, /一般技术限制不应受影响\[S4\]/);
});

test('the provider-neutral verifier preserves model settings and returns a filtered answer', async () => {
  let received;
  const request = async (config, messages, options) => {
    received = { config, messages, options };
    return JSON.stringify({ claims: [
      { claimId: 'C1', verdict: 'outdated', sourceIds: ['S1'], reason: 'S2记录后来修复' },
      { claimId: 'C2', verdict: 'supported', sourceIds: ['S2'], reason: 'S2仍列为待办' },
      { claimId: 'C3', verdict: 'unclear', sourceIds: ['S3'], reason: '没有月底状态' }
    ] });
  };
  const evidenceMessages = [{ role: 'system', content: '规则' }, { role: 'user', content: '[S1]早期问题\n[S2]月底待办\n[S3]当时待确认' }];
  const result = await verifyRangeStatusClaims(draft, evidenceMessages,
    { baseUrl: 'https://api.deepseek.com/chat/completions', apiKey: 'synthetic', model: 'deepseek-flash', thinkingMode: 'low' },
    new AbortController().signal, request);
  assert.equal(result.verdicts.length, 3);
  assert.match(result.answer, /月底仍未完成/);
  assert.doesNotMatch(result.answer, /较早记录的问题|无法确定月底状态/);
  assert.equal(received.config.thinkingMode, 'low');
  assert.equal(received.options.responseFormat, 'json_object');
  assert.equal(received.options.timeoutMs, 20_000);
  assert.match(received.messages[0].content, /不能把曾失败或待验证自动延续/);
});

test('range status verification uses an explicit provider-neutral switch for complete long summaries', () => {
  const enabled = { RAG_STATUS_VERIFICATION_ENABLED: 'true' };
  assert.equal(rangeStatusVerificationEnabled('timeline_summary', 30, enabled), true);
  assert.equal(rangeStatusVerificationEnabled('timeline_summary', 13, enabled), false);
  assert.equal(rangeStatusVerificationEnabled('comparison', 30, enabled), false);
  assert.equal(rangeStatusVerificationEnabled('timeline_summary', 30, {}), false);
});

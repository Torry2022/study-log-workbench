import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDayBlocks} from '../src/markdown-source.mjs';
import {readLogRange} from '../src/range-reader.mjs';

test('single-section continuation keeps AST ownership without changing citation identity or source bytes', () => {
  const blocks=parseDayBlocks('## 2026-09-01\n\n### 1. [Alpha](https://example.test)\n\n'+ '正文。'.repeat(1000)+'\n```md\n### FakeOwner\n```\n后续规则。','2026-09_学习日志.md');
  const args={dateFrom:'2026-09-01',dateTo:'2026-09-01',maxChars:1000};
  const first=readLogRange(blocks,args),second=readLogRange(blocks,{...args,cursor:first.coverage.nextCursor});
  assert.equal(first.contexts[0].rangeSection,undefined);
  assert.deepEqual(second.contexts[0].rangeSection,{heading:'Alpha',headingIndex:0});
  assert.equal(second.contexts[0].heading,null);assert.equal(second.contexts[0].headingIndex,null);
  assert.equal(second.contexts[0].chunkId,'2026-09-01:range:1000');
  assert.equal(second.contexts[0].contentHash,first.contexts[0].contentHash);
  const parts=[first.contexts[0].content,second.contexts[0].content];let page=second;
  while(page.coverage.nextCursor){page=readLogRange(blocks,{...args,cursor:page.coverage.nextCursor});parts.push(page.contexts[0].content);assert.equal(page.contexts[0].rangeSection.heading,'Alpha');}
  assert.equal(parts.join(''),blocks[0].content);
});

test('mixed-section pieces and preamble never inherit a single section ownership', () => {
  const blocks=parseDayBlocks('## 2026-09-01\n\n前言。\n\n### A\n'+ '甲'.repeat(1500)+'\n\n### B\n'+'乙'.repeat(2500),'2026-09_学习日志.md');
  const args={dateFrom:'2026-09-01',dateTo:'2026-09-01',maxChars:1000};
  const first=readLogRange(blocks,args),crossed=readLogRange(blocks,{...args,cursor:first.coverage.nextCursor}),third=readLogRange(blocks,{...args,cursor:crossed.coverage.nextCursor});
  assert.equal(first.contexts[0].rangeSection,undefined);assert.equal(crossed.contexts[0].rangeSection,undefined);
  assert.deepEqual(third.contexts[0].rangeSection,{heading:'B',headingIndex:1});
});

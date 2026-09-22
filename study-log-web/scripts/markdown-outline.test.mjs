import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarkdownOutline } from '../lib/markdown-outline.ts';
test('outline follows root Markdown headings across mixed and nested fences', () => {
 const content = ['## 2026-01-15', '### 1. **正文**', '````md', '```', '### hidden', '~~~', '````', '> ### quoted', '- item', '  ### nested', '### 2. 同名', '### 2. 同名', '#### [链接](https://example.invalid)'].join('\n');
 assert.deepEqual(buildMarkdownOutline(content).map(({id,level,line})=>({id,level,line})), [
  {id:'1-正文',level:3,line:2}, {id:'2-同名',level:3,line:11}, {id:'2-同名-2',level:3,line:12}, {id:'链接',level:4,line:13}
 ]);
});

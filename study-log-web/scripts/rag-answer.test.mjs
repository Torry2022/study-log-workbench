import assert from "node:assert/strict";
import test from "node:test";
import { buildRagMessages, normalizeRagAnswer, parseRagHistory, stripRagCitationLabels } from "../lib/rag-answer.ts";

const source = (sourceId, headingIndex = 0) => ({ sourceId, date: "2026-08-01", month: "2026-08", fileName: "2026-08.md", heading: "合成主题", headingIndex, chunkId: `chunk-${headingIndex}`, contentHash: `hash-${headingIndex}`, excerpt: "合成摘录" });

test('prompt preserves range piece section context while citation identity stays at day level', () => {
  const item={...source('S1'),heading:null,headingIndex:null,content:'后续应按Beta规则。',rangeSection:{heading:'Alpha项目',headingIndex:1}};
  const messages=buildRagMessages('Alpha如何继续？',[],[item]);
  assert.ok(messages.at(-1).content.includes('第2个小节「Alpha项目」'));
  assert.ok(messages.at(-1).content.includes('不是另一条独立日志'));
  const result=normalizeRagAnswer('查阅Beta[S1]',[item]);assert.equal(result.citations[0].heading,null);assert.equal(result.citations[0].contentHash,item.contentHash);
});

test('prompt ties truncation to its source without labelling other excerpts complete', () => {
  const items=[{...source('S1'),content:'部分条件',truncated:true},{...source('S2',1),content:'其他证据',truncated:false}];
  const body=buildRagMessages('条件是什么？',[],items).at(-1).content;
  const first=body.slice(body.indexOf('[S1]'),body.indexOf('\n\n---\n\n'));
  const second=body.slice(body.indexOf('[S2]'));
  assert.match(first,/本来源正文有截断/);
  assert.doesNotMatch(second,/本来源正文有截断|完整小节|完整日志/);
  assert.equal(items[0].content,'部分条件');
  assert.equal(items[0].contentHash,'hash-0');
});

test("citation numbering follows first use and preserves exact source identity", () => {
  const first = source("S1"), second = source("S2", 1);
  const result = normalizeRagAnswer("结论[S2]，再次[S2]，另一结论[S1]，不存在[S99]。", [first, second]);
  assert.equal(result.answer, "结论[S1]，再次[S1]，另一结论[S2]，不存在。");
  assert.deepEqual(result.citations, [{ ...second, sourceId: "S1" }, { ...first, sourceId: "S2" }]);
  assert.equal(second.sourceId, "S2");
  assert.deepEqual(normalizeRagAnswer("无引用", [first]).citations, []);
});

test('lowercase bracketed citations share the canonical source identity without rewriting literal text',()=>{
  const first=source('S1'),ninth=source('S9',8);
  const result=normalizeRagAnswer('条件[s9]，后续[S1]，再引[S9]。变量s9与`s9 [s9]`，链接[s9](https://example.test/s9)，未知[s99]。',[first,ninth]);
  assert.equal(result.answer,'条件[S1]，后续[S2]，再引[S1]。变量s9与`s9 [s9]`，链接[s9](https://example.test/s9)，未知。');
  assert.deepEqual(result.citations,[{...ninth,sourceId:'S1'},{...first,sourceId:'S2'}]);
  assert.equal(stripRagCitationLabels('条件[s9]，代码`[s9]`。'),'条件，代码`[s9]`。');
  assert.equal(parseRagHistory([{role:'assistant',content:'历史条件[s9]，代码`[s9]`。'}])[0].content,'历史条件，代码`[s9]`。');
});

test("bare source mentions follow their citations after first-use renumbering", () => {
  const sources = Array.from({ length: 5 }, (_, i) => source(`S${i + 1}`, i));
  const answer = "旧事故[S3]；S5 说明正式规则[S5]，S4 说明旧规则[S4]。\n\n" +
    "`S5` 和 [链接](https://example.test/S4) 应保持原文。\n\n```md\nS5 示例\n```";
  const result = normalizeRagAnswer(answer, sources);
  assert.match(result.answer, /旧事故\[S1\]；S2 说明正式规则\[S2\]，S3 说明旧规则\[S3\]/);
  assert.match(result.answer, /`S5` 和 \[链接\]\(https:\/\/example\.test\/S4\)/);
  assert.match(result.answer, /```md\nS5 示例\n```/);
  assert.deepEqual(result.citations.map((item) => item.headingIndex), [2, 4, 3]);
});

test('a source mentioned without brackets cannot collide with a renumbered citation',()=>{
  const partial=source('S1'),complete=source('S4',1);
  const result=normalizeRagAnswer('完整条件[S4]。S1 是部分片段，S4 是完整来源。',[partial,complete]);
  assert.equal(result.answer,'完整条件[S1]。S2 是部分片段，S1 是完整来源。');
  assert.deepEqual(result.citations,[{...complete,sourceId:'S1'},{...partial,sourceId:'S2'}]);
});

test('bare and bracketed references share first-use order, protected and unknown labels stay literal',()=>{
  const sources=[source('S1'),source('S4',1)];
  const result=normalizeRagAnswer('S4 给出完整条件，片段[S1]。`S1`、<span data-source="S4"></span>、[链接 S1](https://example.test/S4)、S99 和 [S99]。',sources);
  assert.equal(result.answer,'S1 给出完整条件，片段[S2]。`S1`、<span data-source="S4"></span>、[链接 S1](https://example.test/S4)、S99 和 。');
  assert.deepEqual(result.citations.map(item=>item.headingIndex),[1,0]);
});

test("citation-like tokens inside code and links remain literal and do not create sources", () => {
  const answer = "`items[S1]`\n\n```js\nitems[S2]\n```\n\n[link](https://example.test/[S1])\n\n事实[S2]";
  const result = normalizeRagAnswer(answer, [source("S1"), source("S2", 1)]);
  assert.equal(result.answer, answer.replace("事实[S2]", "事实[S1]"));
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].headingIndex, 1);
});

test("missing grounding is advisory; general supplement is separated from log evidence", () => {
  const claim = "这是一个足够长且包含具体技术结论的合成句子，用来验证缺少引用时的提示。";
  assert.ok(normalizeRagAnswer(claim, []).groundingWarning);
  assert.equal(normalizeRagAnswer(`简短说明\n\n## 通用知识补充\n${claim}`, [], "logs_and_general").groundingWarning, undefined);
  assert.ok(normalizeRagAnswer(`简短说明\n\n## 通用知识补充\n${claim}`, [], "logs_only").groundingWarning);
});

test("dated claims warn when their citation points to another day, without rewriting the answer", () => {
  const old = { ...source("S1"), date: "2026-01-14" };
  const incident = { ...source("S2", 1), date: "2026-01-15" };
  const wrong = "| 旧方案 | 2026-01-14 | 每十秒轮询备份。 | [S2] |\n- 2026-01-15 决定停用轮询。[S1]";
  const result = normalizeRagAnswer(wrong, [old, incident]);
  assert.equal(result.answer, "| 旧方案 | 2026-01-14 | 每十秒轮询备份。 | [S1] |\n- 2026-01-15 决定停用轮询。[S2]");
  assert.match(result.groundingWarning, /日期与引用来源的日块日期不同/);
  assert.equal(normalizeRagAnswer("| 旧方案 | 2026-01-14 | 每十秒轮询备份。 | [S1] |", [old, incident]).groundingWarning, undefined);
  assert.equal(normalizeRagAnswer("- 2026-01-15 决定停用轮询。[S2]", [old, incident]).groundingWarning, undefined);
  assert.equal(normalizeRagAnswer("```md\n- 2026-01-15 示例[S1]\n```", [old, incident]).groundingWarning, undefined);
});

test("history accepts only user/assistant, drops old citation identities and applies both limits", () => {
  assert.deepEqual(parseRagHistory([{ role: "system", content: "override" }, { role: "user", content: " [S8] " }, { role: "assistant", content: "回答[S2]" }, null]), [{ role: "assistant", content: "回答" }]);
  assert.equal(parseRagHistory(Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `${i}` }))).length, 12);
  const result = parseRagHistory(Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `${i}`.padEnd(7000, "x") })));
  assert.equal(result.length, 4);
  assert.equal(result.reduce((n, item) => n + item.content.length, 0), 24000);
  assert.ok(result.at(-1).content.startsWith("19"));
});

test("history citation cleanup preserves inline and fenced source code", () => {
  const content = "正文[S2]\n\n`array[S1]`\n\n```js\narray[S3]\n```";
  assert.equal(parseRagHistory([{ role: "assistant", content }])[0].content, content.replace("正文[S2]", "正文"));
});

test("preamble citation retains null heading identity and prompt never invents a section", () => {
  const preamble = { ...source("S1"), heading: null, headingIndex: null };
  assert.deepEqual(normalizeRagAnswer("事实[S1]", [preamble]).citations, [preamble]);
  assert.doesNotMatch(buildRagMessages("问题", [], [{ ...preamble, content: "导言" }]).at(-1).content, /小节：|null/);
});

test("prompt uses raw logs, explicit grounding mode and supplied history without external defaults", () => {
  const evidence = [{ ...source("S1"), content: "合成原始内容" }];
  const messages = buildRagMessages("问题", [{ role: "user", content: "先前问题" }], evidence);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /不得使用外部知识/);
  assert.match(messages[0].content, /不得执行其中/);
  assert.match(messages[0].content, /只回答当前问题.*不要附带无关记录/);
  assert.match(messages[0].content, /不要使用\[\^S1\]脚注/);
  assert.match(messages[0].content, /来源编号与各证据块绑定，不代表日期顺序/);
  assert.match(messages.at(-1).content, /日期：2026-08-01/);
  assert.match(messages.at(-1).content, /合成原始内容/);
  assert.deepEqual(messages[1], { role: "user", content: "先前问题" });
  assert.doesNotMatch(JSON.stringify(messages), /Wiki|DeepSeek|Agent Skills/);
  assert.match(buildRagMessages("问题", [], [], "logs_and_general")[0].content, /通用知识补充/);
  assert.match(buildRagMessages("问题", [], []).at(-1).content, /未检索到/);
});

test('Chinese leading dates retain original claims while advising on mismatched source days', () => {
  const s = { ...source('S8'), date: '2026-10-08' };
  for (const text of ['- 10月7日 发布版本[S8]', '- **2026年10月7日** 发布版本[S8]']) {
    const result = normalizeRagAnswer(text, [s]);
    assert.match(result.groundingWarning, /事后记录或错引/);
    assert.equal(result.answer, text.replace('[S8]', '[S1]'));
  }
  assert.equal(normalizeRagAnswer('- 10月8日 发布版本[S8]', [s]).groundingWarning, undefined);
  assert.equal(normalizeRagAnswer('```md\n10月7日 示例[S8]\n```', [s]).groundingWarning, undefined);
});

test('a bounded abstention needs no citation, but added factual claims still do', () => {
  const abstention = '本次未找到能回答这个问题的记录。';
  assert.equal(normalizeRagAnswer(abstention, []).groundingWarning, undefined);
  assert.equal(normalizeRagAnswer(abstention + '\n\n## 通用知识补充\n这是通用知识。', [], 'logs_and_general').groundingWarning, undefined);
  assert.ok(normalizeRagAnswer(abstention + '\n实验确定因为温度不足而失败，需要提高水温并延长光照来解决。', []).groundingWarning);
});

test('abstention output survives every chunk boundary and never trims partial or general answers', async () => {
 const {createRagAnswerOutput,NO_LOG_EVIDENCE}=await import('../lib/rag-answer.ts');
 const raw='  '+NO_LOG_EVIDENCE+'\n无关解释[S1]';
 for(let boundary=0;boundary<=raw.length;boundary++){
  let actual='';const output=createRagAnswerOutput('logs_only',text=>{actual+=text;});
  output.push(raw.slice(0,boundary));output.push(raw.slice(boundary));output.flush();
  assert.equal(actual,NO_LOG_EVIDENCE);assert.equal(output.noEvidence,true);
 }
 for(const [mode,raw]of [['logs_only','部分有依据[S2]。'+NO_LOG_EVIDENCE],['logs_only','本次未找到'],['logs_only','`'+NO_LOG_EVIDENCE+'` 是一句示例。']]){
  let actual='';const output=createRagAnswerOutput(mode,text=>{actual+=text;});
  for(const c of raw)output.push(c);output.flush();assert.equal(actual,raw);assert.equal(output.noEvidence,false);
 }
});

test('abstention retains general knowledge after its heading across all stream boundaries', async () => {
 const {createRagAnswerOutput,NO_LOG_EVIDENCE}=await import('../lib/rag-answer.ts');
 const raw=NO_LOG_EVIDENCE+'\n无关来源[S2]\n## 通用知识补充\n通用说明';
 for(let split=0;split<=raw.length;split++){
  let actual='';const output=createRagAnswerOutput('logs_and_general',text=>{actual+=text;});
  output.push(raw.slice(0,split));output.push(raw.slice(split));output.flush();
  assert.equal(actual,NO_LOG_EVIDENCE+'\n\n## 通用知识补充\n通用说明');assert.equal(output.answer,actual);assert.equal(output.noEvidence,true);
 }
});

import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { planRagRetrieval } from "../lib/rag-retrieval-plan.ts";
import { EvidenceRun, collectRagEvidence } from "../lib/rag-evidence.ts";
import { McpRetrievalError, validateRangePage } from "../lib/mcp-client.ts";
import { readLogRange } from "../../study-log-mcp/src/range-reader.mjs";

const block = (date, content = "条件成立才适用，并非所有情况都成立。") => ({ date, month: date.slice(0, 7), fileName: `${date.slice(0, 7)}_学习日志.md`, content });
const config = { url: "http://unused.test", token: "synthetic" };
const readers = blocks => ({ search: async () => { throw Error("must enumerate"); }, read: async args => validateRangePage(readLogRange(blocks, args)) });

test('complete range distinguishes unrecorded calendar dates from unread records',async()=>{
  for(const [from,to,dates,absent]of [
    ['2026-11-28','2026-12-03',['2026-11-29','2026-12-02'],4],
    ['2024-02-28','2024-03-01',['2024-02-29'],2],
    ['2026-06-01','2026-06-02',[],2],
    ['2026-07-01','2026-07-01',['2026-07-01'],0]
  ]){
    const run=new EvidenceRun(new AbortController().signal);
    await collectRagEvidence('合成范围总结',{strategy:'timeline_summary',dateFrom:from,dateTo:to},run,config,readers(dates.map(date=>block(date))));
    assert.equal(run.snapshot().scopes[0].unrecordedDayCount,absent);
    assert.ok(run.answerReport().includes(`已确认无已保存日志的日历日期数${absent}`));
    assert.match(run.answerReport(),/不属于读取遗漏/);
    assert.match(run.answerReport(),/不代表当天没有学习/);
    assert.equal(JSON.parse(run.report()).scopes[0].unrecordedDayCount,absent);
    run.limited=true;
    if(run.contexts.length){run.contexts[0].truncated=true;run.compactedSources.add(run.contexts[0].sourceId);}
    assert.equal(run.snapshot().scopes[0].unrecordedDayCount,absent,'Reduced model material does not undo a completed enumeration');
  }
});

test('search, incomplete enumeration and changed source never assert absent records',()=>{
  const run=new EvidenceRun(new AbortController().signal);
  const complete={dateFrom:'2026-06-01',dateTo:'2026-06-03',totalDays:1,readDates:['2026-06-01'],status:'complete'};
  for(const change of [
    {status:'search'},{status:'partial'},{status:'failed'},
    {totalDays:null},{readDates:[]},{readDates:['2026-05-31']},
    {dateFrom:undefined},{dateTo:'2026-02-30'},{dateTo:'2026-05-31'}
  ]){
    run.coverage=[{...complete,...change}];
    assert.equal(run.snapshot().scopes[0].unrecordedDayCount,null);
    assert.ok(!/已确认无已保存日志的日历日期数\d/.test(run.answerReport()));
  }
  run.coverage=[complete];run.sourceChanged=true;
  assert.equal(run.snapshot().scopes[0].unrecordedDayCount,null);
});

test('source change during an Agent search keeps its fatal classification and blocks later reads',async()=>{
  const run=new EvidenceRun(new AbortController().signal);
  await assert.rejects(collectRagEvidence('new lead',{strategy:'relevance'},run,config,{
    search:async()=>{throw new McpRetrievalError('MCP_SOURCE_CHANGED','source changed');},
    read:async()=>assert.fail('must not read')
  }),{code:'MCP_SOURCE_CHANGED'});
  assert.equal(run.sourceChanged,true);assert.equal(run.stopReason,'source_changed');
  assert.equal(run.take('read_log_range',{dateFrom:'2026-09-01',dateTo:'2026-09-01'}),false);
});

test('answer coverage preserves each scope and source limitation without internal field names',()=>{
  const run=new EvidenceRun(new AbortController().signal);
  run.coverage=[
    {dateFrom:'2026-09-01',dateTo:'2026-09-30',totalDays:2,readDates:['2026-09-01','2026-09-03'],status:'complete'},
    {dateFrom:'2026-10-01',dateTo:'2026-10-31',totalDays:3,readDates:['2026-10-02'],status:'partial'},
    {dateFrom:'2026-08-01',dateTo:'2026-08-31',totalDays:0,readDates:[],status:'empty'},
    {dateFrom:'2026-07-01',dateTo:'2026-07-31',totalDays:null,readDates:[],status:'failed'},
    {totalDays:null,readDates:['2026-06-01'],status:'search'}
  ];
  run.contexts=[{sourceId:'S1',date:'2026-09-01',content:'部分条件',truncated:true},{sourceId:'S2',date:'2026-10-02',content:'摘录',truncated:false}];
  run.compactedSources.add('S2');run.limited=true;run.sourceChanged=true;run.stopReason='tool_failure';
  const machine=JSON.parse(run.report()),text=run.answerReport();
  assert.equal(machine.scopes[0].lastReadDate,'2026-09-03');assert.equal(machine.scopes[1].lastReadDate,'2026-10-02');
  assert.match(text,/2026-09-01至2026-09-30：已完整读取该范围的日志日块；日志日块总数2；已读日期2026-09-01、2026-09-03；实际最后读取日期2026-09-03/);
  for(const expected of ['读取不完整','已确认该范围没有日志','读取失败','未穷尽范围','日志日块总数未确定','正文有截断的来源：[S1]','已改为原文摘录的来源：[S2]','最终保留材料的日期：2026-09-01、2026-10-02','补查工具失败','本轮材料不完整或取证受限','不能混用版本','范围读完不等于最终材料包含全部细节'])assert.ok(text.includes(expected),expected);
  assert.doesNotMatch(text,/truncatedSources|compactedSources|retainedDates|lastReadDate|stopReason|sourceChanged/);
  assert.deepEqual(JSON.parse(run.report()),machine,'Answer representation must not mutate internal evidence');
});

test('answer coverage distinguishes model termination from hard budgets',()=>{
  const run=new EvidenceRun(new AbortController().signal);
  const reasons={tool_budget:'工具调用次数达到上限',repeated_query:'重复查询已停止',no_new_evidence:'未取得新的证据',step_limit:'补查轮数达到上限',decision_output_limit:'模型未完整结束补查决策',tool_failure:'补查工具失败',invalid_read_date:'模型选择的日期不在允许读取的集合中',evidence_limit:'保留材料达到容量上限',evidence_assessed:'模型已完成材料判断，最终回答仍须依据原文',unstructured_answer:'模型未按受检格式提交，已改用普通回答流程',empty_answer:'模型未生成回答正文',source_changed:'读取期间原文改变'};
  for(const [reason,description]of Object.entries(reasons)){run.stopReason=reason;assert.ok(run.answerReport().includes(description));}
  run.stopReason=undefined;assert.match(run.answerReport(),/取证停止原因：未提供/);
  assert.match(run.answerReport(),/取证模型决定结束不代表程序证明完整/);
});

test("implicit comparison enumerates both periods and rejected comparison reads only the replacement scope", async () => {
  const blocks = [block("2026-08-01"), block("2026-09-01"), block("2026-10-01")];
  for (const [question, expected] of [
    ["2026年八月和十月的做法有什么变化？", ["2026-08-01", "2026-10-01"]],
    ["不用比较2026年九月和十月，只总结十月。", ["2026-10-01"]]
  ]) {
    const run = new EvidenceRun(new AbortController().signal);
    await collectRagEvidence(question, planRagRetrieval(question), run, config, readers(blocks));
    assert.deepEqual(run.contexts.map(item => item.date), expected);
    assert.ok(run.coverage.every(scope => scope.status === "complete"));
  }
});

test("literal constraints survive dates and event dates are not log filters", () => {
  const literal = planRagRetrieval("2026年9月的日志中哪里提到过`Agent`？");
  assert.equal(literal.dateFrom, "2026-09-01"); assert.equal(literal.literalQuery, "Agent");
  const event = planRagRetrieval("我记录过哪些关于2026年9月15日发布的模型的使用体验？");
  assert.equal(event.dateFrom, undefined); assert.equal(event.eventDates, true);
});
test("comparison reads both independent months and never intervening months", async () => {
  const plan = planRagRetrieval("比较2026年8月和2026年10月的学习内容");
  assert.equal(plan.strategy, "comparison"); assert.equal(plan.ranges.length, 2);
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("compare", plan, run, config, readers([block("2026-08-01"), block("2026-09-01"), block("2026-10-01")]));
  assert.deepEqual(run.contexts.map(item => item.date), ["2026-08-01", "2026-10-01"]);
  assert.deepEqual(run.contexts.map(item => item.sourceId), ["S1", "S2"]);
  assert.ok(run.coverage.every(scope => scope.status === "complete"));
});

test("Chinese and omitted-year months remain separate, while an explicit month range includes the gap", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  for (const question of ["比较九月和十月", "比较2026年9月和10月"]) {
    assert.deepEqual(planRagRetrieval(question, now).ranges, [
      { dateFrom: "2026-09-01", dateTo: "2026-09-30" }, { dateFrom: "2026-10-01", dateTo: "2026-10-31" }
    ]);
  }
  assert.deepEqual(planRagRetrieval("总结2026年8月至10月", now).ranges, [{ dateFrom: "2026-08-01", dateTo: "2026-10-31" }]);
});

test("31-day months are fully retained independently of the 30-citation client limit", async () => {
  const blocks = Array.from({ length: 31 }, (_, index) => block(`2026-10-${String(index + 1).padStart(2, "0")}`));
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年10月总结"), run, config, readers(blocks));
  assert.equal(run.contexts.length, 31); assert.equal(run.limited, false); assert.equal(run.coverage[0].status, "complete");
});
test("thirty-day summary enumerates every day instead of top twenty", async () => {
  const blocks = Array.from({ length: 30 }, (_, index) => block(`2026-09-${String(index + 1).padStart(2, "0")}`));
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), run, config, readers(blocks));
  assert.equal(run.contexts.length, 30); assert.equal(run.coverage[0].readDates.length, 30);
  assert.equal(run.coverage[0].status, "complete"); assert.equal(run.calls, 2);
});
test("partial, failed and empty scopes remain distinct", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  await collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), run, config, readers([]));
  assert.equal(run.coverage[0].status, "empty");
  await collectRagEvidence("summary", planRagRetrieval("2026年10月总结"), run, config, { read: async () => { throw Error(); } });
  assert.equal(run.coverage[1].status, "failed");
  assert.match(run.report(), /failed/);
});
test("cursor prevents mixed revisions and long days can be read without dropped characters", () => {
  const blocks = [block("2026-09-01", "甲".repeat(45000))];
  const first = readLogRange(blocks, { dateFrom: "2026-09-01", dateTo: "2026-09-01" });
  const second = readLogRange(blocks, { dateFrom: "2026-09-01", dateTo: "2026-09-01", cursor: first.coverage.nextCursor });
  assert.equal(first.context.totalChars + second.context.totalChars, 45000);
  assert.deepEqual(second.coverage.completedDates, ["2026-09-01"]);
  assert.throws(() => readLogRange([block("2026-09-01", "已修改")], { dateFrom: "2026-09-01", dateTo: "2026-09-01", cursor: first.coverage.nextCursor }), { code: "SOURCE_CHANGED" });
});

test("a changed range revision stops the run before registering the next page", async () => {
  const data = [block("2026-09-01", "甲".repeat(45000))];
  const run = new EvidenceRun(new AbortController().signal);
  let reads = 0;
  await collectRagEvidence("summary", planRagRetrieval("比较2026年9月和10月"), run, config, {
    read: async args => {
      reads++;
      const page = validateRangePage(readLogRange(data, args));
      if (args.cursor) page.coverage.revision = "b".repeat(64);
      return page;
    }
  });
  assert.equal(reads, 2);
  assert.equal(run.sourceChanged, true);
  assert.equal(run.limited, true);
  assert.equal(run.stopReason, "source_changed");
  assert.equal(run.contexts.length, 1);
  assert.equal(run.coverage[0].status, "failed");
});

test('optional range section context is validated, retained and never changes citation heading identity', () => {
  const data=[block('2026-09-01','## 2026-09-01\n\n### Alpha\n\n'+'正文。'.repeat(1000))];
  const args={dateFrom:'2026-09-01',dateTo:'2026-09-01',maxChars:1000};
  const first=readLogRange(data,args),second=readLogRange(data,{...args,cursor:first.coverage.nextCursor});
  const parsed=validateRangePage(second).contexts[0];
  assert.deepEqual(parsed.rangeSection,{heading:'Alpha',headingIndex:0});assert.equal(parsed.heading,null);
  for(const invalid of [null,{heading:'',headingIndex:0},{heading:'Alpha',headingIndex:-1},{heading:'Alpha',headingIndex:0,extra:true}]){
    const changed=structuredClone(second);changed.contexts[0].rangeSection=invalid;
    assert.throws(()=>validateRangePage(changed),{code:'MCP_INVALID_RESPONSE'});
  }
  const noVersion=structuredClone(second);delete noVersion.contexts[0].dayContentHash;
  assert.throws(()=>validateRangePage(noVersion),{code:'MCP_INVALID_RESPONSE'});
  delete second.contexts[0].rangeSection;assert.equal(validateRangePage(second).contexts[0].rangeSection,undefined);
});
test("call cap, duplicate requests and cancellation stop actual reads", async () => {
  const run = new EvidenceRun(new AbortController().signal);
  assert.equal(run.take("x", 1), true); assert.equal(run.take("x", 1), false);
  for (let i = 2; i <= 8; i++) assert.equal(run.take("x", i), true);
  assert.equal(run.take("x", 9), false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectRagEvidence("summary", planRagRetrieval("2026年9月总结"), new EvidenceRun(controller.signal), config, readers([])), { name: "AbortError" });
});

test('coverage reports independent last-read dates without inventing requested month-end progress', () => {
  const run=new EvidenceRun(new AbortController().signal);
  run.coverage=[
    {dateFrom:'2026-09-01',dateTo:'2026-09-30',totalDays:3,readDates:['2026-09-30','2026-09-01','2026-09-22'],status:'complete'},
    {dateFrom:'2026-10-01',dateTo:'2026-10-31',totalDays:10,readDates:['2026-10-10','2026-10-01'],status:'partial'},
    {dateFrom:'2026-11-01',dateTo:'2026-11-30',totalDays:0,readDates:[],status:'empty'}
  ];
  const original=structuredClone(run.coverage);
  const scopes=JSON.parse(run.report()).scopes;
  assert.deepEqual(scopes.map(scope=>scope.lastReadDate),['2026-09-30','2026-10-10',null]);
  assert.equal(scopes[1].dateTo,'2026-10-31');assert.equal(scopes[1].status,'partial');
  assert.deepEqual(run.coverage,original);
  run.coverage=[{dateFrom:'2026-09-01',dateTo:'2026-09-30',totalDays:null,readDates:['2026-10-01','2026-02-30','invalid'],status:'failed'}];
  assert.equal(JSON.parse(run.report()).scopes[0].lastReadDate,null);
});


test('model evidence supersedes only contained excerpts from the same day version and section', () => {
  const hash = text => createHash('sha256').update(text).digest('hex');
  const content = '## 2026-09-01\n\n### 1. Alpha\n\n背景及完整条件。\n\n### Beta\n\n另一节的内容。';
  const dayHash = hash(content), fileName = '2026-09_学习日志.md';
  const run = new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName,heading:'Alpha',headingIndex:0,chunkId:'section',content:'背景',contentHash:hash('背景'),dayContentHash:dayHash,truncated:true}]);
  run.add([{date:'2026-09-01',fileName,heading:null,headingIndex:null,chunkId:'2026-09-01:range:0',content,contentHash:dayHash,dayContentHash:dayHash,truncated:false}]);
  assert.equal(run.contexts.length,2,'registry identities must remain intact');
  assert.deepEqual(run.modelContexts().map(item=>item.sourceId),['S2']);
  assert.equal(run.resolveModelSource('S1').sourceId,'S2');
  assert.equal(run.resolveModelSource('S99'),undefined);
  assert.deepEqual(run.snapshot(run.modelContexts()).truncatedSources,[]);
  for (const change of [{heading:'Beta',headingIndex:1},{dayContentHash:undefined},{content:'不存在的原文'},{headingIndex:null}]) {
    const saved={...run.contexts[0]};Object.assign(run.contexts[0],change);
    assert.deepEqual(run.modelContexts().map(item=>item.sourceId),['S1','S2']);
    assert.equal(run.resolveModelSource('S1').sourceId,'S1');
    Object.assign(run.contexts[0],saved);
  }
  run.contexts[1].truncated=true;
  assert.deepEqual(run.modelContexts().map(item=>item.sourceId),['S1','S2']);
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EvidenceRun } from "../lib/rag-evidence.ts";
import { compactEvidence } from "../lib/rag-evidence-summary.ts";
import { parseRagHistory } from "../lib/rag-answer.ts";

test('a small input overflow compacts only the required long source and preserves other days verbatim', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const evidence = JSON.parse(JSON.parse(raw).messages[1].content).evidence;
    requests.push(evidence);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(evidence.map(item=>({sourceId:item.sourceId,excerpts:[item.content.slice(-80)]})))}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const run = new EvidenceRun(new AbortController().signal);
  const contents = Array.from({length:30},(_,i)=>'原'.repeat((i===0?3300:1000)-20)+`条件${i}：没有确认不能保存。`);
  run.add(contents.map((content,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,fileName:'2026-09_学习日志.md',chunkId:`part-${i}`,contentHash:`hash-${i}`,excerpt:'原始摘录',content,truncated:false})));
  await compactEvidence(run,'概括各日期的条件',{baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'mock'});
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].map(item=>item.sourceId),['S1']);
  assert.ok(run.contexts.reduce((sum,item)=>sum+item.content.length,0)<=30000);
  assert.equal(run.contexts.length,30);assert.equal(run.limited,false);
  assert.deepEqual([...run.compactedSources],['S1']);
  for(let i=1;i<30;i++){assert.equal(run.contexts[i].content,contents[i]);assert.equal(run.contexts[i].truncated,false);assert.equal(run.contexts[i].contentHash,`hash-${i}`);}
});

test('short rules remain verbatim between long sources, even when adjacent summaries fail', async t => {
  let malformed = false; const requests = [];
  const rule = '只有来源一致且用户确认才能保存；没有确认不能保存。下一步参照南渡连接检查。';
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), evidence = JSON.parse(body.messages[1].content).evidence;
    requests.push(evidence);
    assert.ok(body.messages[0].content.includes('规则名称'));
    assert.ok(evidence.every(item => !item.content.includes(rule)));
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(malformed ? [] : evidence.map(item=>({sourceId:item.sourceId,excerpts:[item.content.slice(-80)]})))}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const config={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'synthetic',model:'mock'};
  for (const fail of [false,true]) {
    malformed=fail; requests.length=0;
    const run=new EvidenceRun(new AbortController().signal);
    run.add(['长'.repeat(26000),rule,'长'.repeat(26000),rule].map((content,index)=>({date:'2026-09-01',fileName:'synthetic.md',chunkId:`part-${index}`,contentHash:`hash-${index}`,excerpt:'原文摘录',content,truncated:false})));
    await compactEvidence(run,'保存条件和后续步骤？',config);
    assert.equal(requests.length,1);
    assert.deepEqual(requests.flat().map(item=>item.sourceId),['S1']);
    assert.equal(run.contexts[2].content,'长'.repeat(26000));
    for(const index of [1,3]) {
      assert.equal(run.contexts[index].content,rule); assert.equal(run.contexts[index].truncated,false);
      assert.equal(run.contexts[index].contentHash,`hash-${index}`); assert.equal(run.contexts[index].excerpt,'原文摘录');
    }
    assert.equal(run.limited,fail);
    assert.ok(run.contexts.reduce((sum,item)=>sum+item.content.length,0)<=30000);
  }
});

test("batch synthesis keeps original source identity and marks failed compression as partial", async t => {
  let malformed = false;
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const evidence = JSON.parse(JSON.parse(raw).messages[1].content).evidence;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(malformed ? [] : evidence.map(item => ({ sourceId: item.sourceId, excerpts: [item.content.slice(-80)] }))) } }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const make = () => { const run = new EvidenceRun(new AbortController().signal); run.contexts = Array.from({ length: 6 }, (_, index) => ({ sourceId: `S${index + 1}`, date: "2026-09-01", content: "原始条件".repeat(1500), excerpt: "原始摘录", contentHash: "a".repeat(64) })); return run; };
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "synthetic", model: "mock" };
  const run = make(); await compactEvidence(run, "条件是什么？", config);
  assert.equal(run.limited, false); assert.equal(run.contexts[5].sourceId, "S6"); assert.equal(run.contexts[0].excerpt, "原始摘录"); assert.equal(run.contexts[0].contentHash, "a".repeat(64));
  malformed = true; const failed = make(); await compactEvidence(failed, "条件是什么？", config);
  assert.equal(failed.limited, true);
  assert.ok(failed.contexts.slice(0,2).every(item => item.truncated && item.content.length === 900));
  assert.ok(failed.contexts.slice(2).every(item => !item.truncated && item.content === '原始条件'.repeat(1500)));
  const aborted = make(); const controller = new AbortController(); controller.abort();
  await assert.rejects(compactEvidence(Object.assign(aborted, { signal: controller.signal }), "question", config));
});

test("source pointers reject path traversal, mismatched dates and bad numbering without shifting remaining sources", () => {
  const ref = { date: "2026-09-01", fileName: "2026-09_学习日志.md", heading: null, contentHash: "a".repeat(64) };
  const history = sourceRefs => parseRagHistory([{ role: "assistant", content: "回答[S1]", sourceRefs }])[0];
  assert.deepEqual(history([ref]).sourceRefs, [ref]);
  assert.equal(history([{ ...ref, fileName: "../secret" }, ref]).sourceRefs, undefined);
  assert.equal(history([{ ...ref, date: "2026-10-01" }]).sourceRefs, undefined);
});

test('compaction accepts only ordered original excerpts and never registers invented coverage as evidence', async t => {
  const first = '仅在来源一致且本人确认后才能保存，没有确认不能保存。';
  const last = '下一步参照合成连接检查，不能套用另一项规则。';
  let response;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const ids = JSON.parse(JSON.parse(raw).messages[1].content).evidence.map(item => item.sourceId);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response.filter(item => ids.includes(item.sourceId))) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock' };
  for (const excerpts of [[first, last], ['未提供另一个日期的记录。'], [last, first], [first, first], [''], Array(4).fill(first)]) {
    const run = new EvidenceRun(new AbortController().signal);
    run.add([0, 1].map(index => ({ date: `2026-09-0${index + 1}`, fileName: 'synthetic.md', chunkId: `chunk-${index}`, contentHash: `hash-${index}`, excerpt: '原始摘录', content: `${first}\n\n${'过程内容。'.repeat(5900)}\n\n${last}`, truncated: false })));
    run.coverage = [{ dateFrom: '2026-09-01', dateTo: '2026-09-02', totalDays: 2, readDates: ['2026-09-01', '2026-09-02'], status: 'complete' }];
    response = run.contexts.map(({ sourceId }) => ({ sourceId, excerpts }));
    await compactEvidence(run, '何时可以保存？', config);
    const valid = excerpts.length === 2 && excerpts[0] === first && excerpts[1] === last;
    assert.equal(run.limited, !valid);
    assert.ok(run.contexts.every(item => !item.content.includes('未提供另一个日期')));
    assert.deepEqual([...run.compactedSources], ['S1', 'S2']);
    assert.equal(JSON.parse(run.report()).scopes[0].status, 'complete');
    assert.deepEqual(JSON.parse(run.report()).compactedSources, ['S1', 'S2']);
    if (valid) assert.ok(run.contexts.every(item => item.content === `${first}\n[…]\n${last}` && !item.truncated));
    else assert.ok(run.contexts.every(item => item.truncated));
  }
});

test('repeated compaction checks the original body rather than its inserted omission marker', async t => {
  let calls = 0;
  const first = '甲'.repeat(420), last = '乙'.repeat(420);
  const original = `${first}\n${'中间过程。'.repeat(3200)}\n${last}`;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const evidence = JSON.parse(JSON.parse(raw).messages[1].content).evidence;
    const excerpts = ++calls <= 2 ? [first, last] : [`${'甲'.repeat(20)}\n[…]\n${'乙'.repeat(20)}`];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(evidence.map(({ sourceId }) => ({ sourceId, excerpts }))) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const run = new EvidenceRun(new AbortController().signal);
  const item = (index, content) => ({ date: '2026-09-01', fileName: 'synthetic.md', chunkId: `chunk-${index}`, contentHash: `hash-${index}`, excerpt: '原始摘录', content, truncated: false });
  run.add([item(0, original), item(1, original)]);
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock' };
  await compactEvidence(run, '总结过程', config);
  assert.equal(run.limited, false);
  assert.equal(run.contexts[0].content, `${first}\n[…]\n${last}`);
  run.add(Array.from({ length: 38 }, (_, index) => item(index + 2, '短'.repeat(750))));
  await compactEvidence(run, '总结过程', config);
  assert.equal(run.limited, true);
  assert.equal(run.contexts[0].content, original.slice(0, 750));
  assert.ok(!run.contexts[0].content.includes('[…]'));
  assert.equal(run.compactionOriginals.get('S1'), original);
});

test('long evidence batches bound input and final material while retaining every source and its tail', async t => {
  const requests = [];
  let oversized = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw), evidence = JSON.parse(body.messages[1].content).evidence;
    requests.push(evidence);
    assert.ok(evidence.reduce((sum, item) => sum + item.content.length, 0) <= 30000);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(evidence.map(item => ({ sourceId: item.sourceId, excerpts: [oversized ? '长'.repeat(900) : item.content.slice(-80)] }))) } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'synthetic', model: 'mock' };
  for (const [count, length, invalid] of [[4, 28000, false], [8, 30000, false], [160, 750, false], [160, 750, true]]) {
    oversized = invalid;
    const run = new EvidenceRun(new AbortController().signal);
    run.add(Array.from({ length: count }, (_, i) => {
      const tail = `末尾条件${i}：不满足则不能保存。`;
      return { date: '2026-10-01', fileName: 'synthetic.md', chunkId: `chunk-${i}`, contentHash: `hash-${i}`, excerpt: '原文摘录', content: '原'.repeat(length - tail.length) + tail, truncated: false };
    }));
    const originalCount = run.contexts.length;
    assert.equal(originalCount, count);
    await compactEvidence(run, '保存的条件？', config);
    assert.equal(run.contexts.length, originalCount);
    assert.ok(run.contexts.reduce((sum, item) => sum + item.content.length, 0) <= 30000);
    assert.ok(run.contexts.every((item, i) => item.contentHash === `hash-${i}` && item.excerpt === '原文摘录'));
    if (!invalid) assert.ok(run.contexts.every((item, i) => item.content.includes(`末尾条件${i}`)));
    else assert.ok(run.contexts.every(item => item.truncated));
    assert.equal(run.limited, invalid);
    // Compaction cannot reset the original read budget.
    assert.equal(run.add([{ date: '2026-10-02', fileName: 'synthetic.md', chunkId: 'extra', contentHash: 'extra', content: 'x'.repeat(8 * 30000 - count * length + 1) }]), 0);
    assert.equal(run.stopReason, 'evidence_limit');
  }
  assert.ok(requests.length > 4);
});

test('verified answer capacity keeps full monthly material without calling the light model', async () => {
  const run = new EvidenceRun(new AbortController().signal);
  const contents = Array.from({length:40},(_,i)=>`合成日期${i}。`+'原文条件。'.repeat(200));
  run.add(contents.map((content,i)=>({date:`2026-09-${String(i%30+1).padStart(2,'0')}`,fileName:'synthetic.md',chunkId:`part-${i}`,contentHash:`hash-${i}`,content})));
  const original = run.contexts.map(item=>({...item}));
  await compactEvidence(run,'比较这段期间的变化',{baseUrl:'http://127.0.0.1:1/unused',apiKey:'synthetic',model:'small'},
    {baseUrl:'https://api.deepseek.com/chat/completions',apiKey:'synthetic',model:'deepseek-flash'},[{role:'user',content:'合成历史'.repeat(1000)}]);
  assert.deepEqual(run.contexts,original);
  assert.equal(run.compactedSources.size,0); assert.equal(run.limited,false);
});

test('a model name on an unknown proxy does not declare its context capacity', async () => {
  const run = new EvidenceRun(new AbortController().signal);
  run.add([{date:'2026-09-01',fileName:'synthetic.md',chunkId:'part',contentHash:'hash',content:'原'.repeat(31000)}]);
  await compactEvidence(run,'合成问题',{baseUrl:'http://127.0.0.1:1/unused',apiKey:'synthetic',model:'deepseek-flash'});
  assert.equal(run.limited,true); assert.equal(run.contexts[0].truncated,true);
});

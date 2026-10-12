import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHttpServer } from '../../study-log-mcp/src/http-server.mjs';
import { createRagQueryStream } from '../lib/rag-query.ts';

test('over-context cross-month query reads every day before bounded extraction and retains dates, conditions and failure coverage',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rag-range-compaction-'));
  const data=path.join(root,'data');await fs.mkdir(data);
  const days=[...Array.from({length:30},(_,i)=>`2026-09-${String(i+1).padStart(2,'0')}`),...Array.from({length:5},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')}`)];
  const conclusion=date=>`当日结论${date}：修正早期记录，读取已完成；只有来源一致且用户确认才能保存，没有确认不得保存。`;
  const contents=new Map(days.map(date=>[date,`## ${date}\n\n### 合成读取流程\n\n初次记录：读取尚未开始。\n\n${'合成背景材料。'.repeat(220)}\n\n${conclusion(date)}\n`]));
  for(const month of ['2026-09','2026-10'])await fs.writeFile(path.join(data,`${month}_学习日志.md`),days.filter(date=>date.startsWith(month)).map(date=>contents.get(date)).join('\n'));
  const service=await startHttpServer({logRoot:data,indexRoot:path.join(root,'index'),port:0,token:'synthetic',retrieval:{embedding:{apiKey:''},reranker:{apiKey:''},rerankEnabled:false}});
  const originalFetch=globalThis.fetch,previous=process.env.RAG_AGENT_ENABLED;
  t.after(async()=>{
    globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.RAG_AGENT_ENABLED;else process.env.RAG_AGENT_ENABLED=previous;
    await service.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('rag-range-compaction-'));await fs.rm(root,{recursive:true,force:true});
  });
  process.env.RAG_AGENT_ENABLED='false';
  const chat={baseUrl:'https://model.invalid/synthetic',apiKey:'synthetic',model:'unknown-capacity'};
  for(const malformed of [false,true]){
    let extractionCalls=0,answerCalls=0;const reads=[],extracted=[];
    globalThis.fetch=async(url,init)=>{
      if(String(url)!==chat.baseUrl){
        const body=JSON.parse(init.body);
        if(body.method==='tools/call'){assert.equal(body.params.name,'read_log_range');reads.push(body.params.arguments);}
        return originalFetch(url,init);
      }
      const body=JSON.parse(init.body);
      if(!body.stream){
        extractionCalls++;const {evidence}=JSON.parse(body.messages[1].content);
        assert.ok(evidence.length<=5);assert.ok(evidence.reduce((sum,item)=>sum+item.content.length,0)<=30000);
        // Every extraction starts only after both ranges have been read.
        assert.ok(reads.some(args=>args.dateFrom==='2026-10-01'));
        for(const item of evidence){assert.ok(contents.get(item.date)?.includes(item.content));extracted.push(item.date);}
        return Response.json({choices:[{message:{content:JSON.stringify(malformed?[]:evidence.map(item=>({sourceId:item.sourceId,excerpts:[item.content.includes(conclusion(item.date))?conclusion(item.date):item.content.slice(-80)]})))}}]});
      }
      answerCalls++;assert.equal(body.tools,undefined);
      const system=body.messages[0].content,user=body.messages.at(-1).content;
      const coverage=system.split('程序计算的材料覆盖情况：').at(-1);
      const scopes=coverage.split('\n').filter(line=>/^2026-\d{2}-01至2026-\d{2}-\d{2}：/.test(line));
      assert.equal(scopes.length,2);assert.deepEqual(scopes.flatMap(line=>line.split('；已读日期')[1].split('；实际最后读取日期')[0].split('、')),days);
      assert.ok(scopes.every(line=>line.includes('已完整读取该范围的日志日块')));
      assert.ok(scopes[0].includes('日志日块总数30')&&scopes[0].includes('实际最后读取日期2026-09-30'));
      assert.ok(scopes[1].includes('日志日块总数5')&&scopes[1].includes('实际最后读取日期2026-10-05'));
      assert.equal(coverage.includes('本轮材料不完整或取证受限'),malformed);
      assert.ok([...coverage.match(/已改为原文摘录的来源：([^\n]+)/)[1].matchAll(/\[S\d+\]/g)].length>5);
      assert.ok(!coverage.includes('truncatedSources'));
      const blocks=user.split('\n\n---\n\n');let retainedChars=0;
      const response=[];
      for(const date of days){
        const dateBlocks=blocks.filter(item=>item.includes(`日志日期：${date}`));assert.ok(dateBlocks.length);
        const block=dateBlocks.find(item=>item.includes(conclusion(date)))||dateBlocks[0];
        const sourceId=block.match(/\[(S\d+)\]/)[1];
        for(const part of dateBlocks){const id=part.match(/\[(S\d+)\]/)[1];retainedChars+=part.split('内容：\n')[1].split(`\n以上为[${id}]`)[0].length;}
        if(!malformed){assert.ok(block.includes(conclusion(date)));response.push(`${conclusion(date)}[${sourceId}]`);}
        else response.push(`已读取${date}，部分原文未能保留。[${sourceId}]`);
      }
      assert.ok(retainedChars<=30000);
      if(malformed){assert.match(coverage,/正文有截断的来源：\[S\d+\]/);assert.ok(system.includes('不得声称完整总结'));}
      const answer=malformed?'提取失败，以下仅说明实际读取范围。\n'+response.join('\n'):response.join('\n');
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:answer},finish_reason:null}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    };
    const raw=await new Response(createRagQueryStream({question:'比较2026年9月和10月，各日期读取和保存的最终条件是什么？',mode:'logs_only',history:[]},{chat,lightChat:chat,mcp:{url:`http://127.0.0.1:${service.address.port}/mcp`,token:'synthetic'}},new AbortController().signal)).text();
    assert.match(raw.trim().split('\n\n').at(-1),/^event: done/);
    const done=JSON.parse(raw.trim().split('\n\n').at(-1).split('\n')[1].slice(6));
    assert.ok(extractionCalls>1);assert.equal(answerCalls,1);assert.equal(done.diagnostics.agent,undefined);
    assert.deepEqual(done.citations.map(item=>item.date),days);assert.ok(done.diagnostics.toolCalls<=8);
    assert.ok(new Set(extracted).size>5);
  }
});

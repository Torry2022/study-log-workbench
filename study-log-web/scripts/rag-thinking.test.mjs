import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRagThinking, chatThinkingParameters, getChatConfig } from '../lib/ai-config.ts';
import { requestChat } from '../lib/ai-chat.ts';
import { streamRagAnswer } from '../lib/rag-stream.ts';
import { createAgentModel, supplementEvidence } from '../lib/rag-agent.ts';
import { EvidenceRun } from '../lib/rag-evidence.ts';

const config={baseUrl:'https://api.deepseek.com/v1/chat/completions?synthetic=one',model:'deepseek-flash',apiKey:'synthetic'};
const messages=[{role:'user',content:'合成问题'}];
function stream(){return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'合成回答'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}

test('explicit RAG thinking rejects unverified providers and leaves other AI configuration unchanged',()=>{
  assert.equal(configureRagThinking(config,{}),config);
  assert.deepEqual(chatThinkingParameters(config),{});
  for(const mode of ['disabled','low']){
    const configured=configureRagThinking(config,{RAG_DEEPSEEK_THINKING:mode});
    assert.equal(configured.thinkingMode,mode);
    assert.equal(config.thinkingMode,undefined);
    assert.equal(getChatConfig({CHAT_API_KEY:'synthetic',CHAT_API_URL:config.baseUrl,CHAT_MODEL:config.model,RAG_DEEPSEEK_THINKING:mode}).thinkingMode,undefined);
  }
  for(const invalid of [{...config,baseUrl:'https://proxy.invalid/chat'}, {...config,baseUrl:'http://api.deepseek.com/chat'}, {...config,model:'unknown'}]){
    assert.throws(()=>configureRagThinking(invalid,{RAG_DEEPSEEK_THINKING:'disabled'}),{code:'AI_CONFIGURATION_INVALID'});
    assert.throws(()=>chatThinkingParameters({...invalid,thinkingMode:'disabled'}),{code:'AI_CONFIGURATION_INVALID'});
  }
  assert.throws(()=>configureRagThinking(config,{RAG_DEEPSEEK_THINKING:'arbitrary'}),{code:'AI_CONFIGURATION_INVALID'});
});

test('ordinary answer and SDK send identical thinking controls without changing full URL or tool messages',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const mode of [undefined,'disabled','low']){
    const configured=configureRagThinking(config,mode?{RAG_DEEPSEEK_THINKING:mode}:{});
    const bodies=[];
    const transport=async(url,init)=>{
      assert.equal(url,config.baseUrl);assert.equal(init.redirect,'error');
      assert.equal(new Headers(init.headers).get('authorization'),'Bearer synthetic');
      const body=JSON.parse(init.body);bodies.push(body);
      return body.stream?stream():Response.json({choices:[{message:{content:'合成回答'},finish_reason:'stop'}]});
    };
    globalThis.fetch=transport;
    assert.equal(await requestChat(configured,messages),'合成回答');
    assert.equal(await streamRagAnswer(configured,messages,()=>{}),'合成回答');
    const run=new EvidenceRun(new AbortController().signal);
    const result=await supplementEvidence('合成问题',{strategy:'relevance'},run,{},createAgentModel(configured,transport),()=>{},undefined,{mode:'logs_only',history:[]});
    assert.equal(result.answer,'合成回答');assert.equal(bodies.length,3);
    for(const body of bodies){
      assert.deepEqual(body.thinking,mode?{type:mode==='low'?'enabled':'disabled'}:undefined);
      assert.equal(body.reasoning_effort,mode==='low'?'low':undefined);
      assert.ok(Array.isArray(body.messages));
    }
    assert.ok(bodies[2].tools.some(tool=>tool.function.name==='search'));
  }
});

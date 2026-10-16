import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRagThinking, chatThinkingParameters, getChatConfig, inspectRagChatConfig, inspectChatConfig } from '../lib/ai-config.ts';
import { requestChat } from '../lib/ai-chat.ts';
import { streamRagAnswer } from '../lib/rag-stream.ts';
import { createAgentModel, supplementEvidence } from '../lib/rag-agent.ts';
import { EvidenceRun } from '../lib/rag-evidence.ts';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as aiConfig from '../lib/ai-config.ts';

const config={baseUrl:'https://api.deepseek.com/v1/chat/completions?synthetic=one',model:'deepseek-flash',apiKey:'synthetic'};
const messages=[{role:'user',content:'合成问题'}];

test('actual query route shares explicit thinking with same-model RAG tasks only',async t=>{
  const keys=['CHAT_API_URL','CHAT_API_KEY','CHAT_MODEL','CHAT_LIGHT_MODEL','RAG_DEEPSEEK_THINKING'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const source=await fs.readFile(new URL('../app/api/rag/query/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};let actual;
  runInNewContext(code,{exports,Buffer,TextDecoder,Response,require:name=>{
    if(name==='@/lib/auth')return {requireAuth:()=>null};
    if(name==='@/lib/ai-config')return aiConfig;
    if(name==='@/lib/mcp-config')return {getMcpConfig:()=>({url:'http://synthetic.test/mcp',token:'synthetic'})};
    if(name==='@/lib/rag-answer')return {parseRagHistory:()=>[]};
    if(name==='@/lib/rag-query')return {createRagQueryStream:(_input,config)=>{actual=config;return new ReadableStream({start(controller){controller.close();}});}};
    throw Error(`Unexpected runtime import ${name}`);
  }});
  for(const mode of [undefined,'disabled','low'])for(const light of [undefined,config.model,'independent-light']){
    Object.assign(process.env,{CHAT_API_KEY:'synthetic',CHAT_API_URL:config.baseUrl,CHAT_MODEL:config.model});
    if(mode===undefined)delete process.env.RAG_DEEPSEEK_THINKING;else process.env.RAG_DEEPSEEK_THINKING=mode;
    if(light===undefined)delete process.env.CHAT_LIGHT_MODEL;else process.env.CHAT_LIGHT_MODEL=light;
    const response=await exports.POST(new Request('http://synthetic.test/api/rag/query',{method:'POST',body:JSON.stringify({question:'合成追问'})}));
    assert.equal(response.status,200);
    assert.equal(actual.chat.thinkingMode,mode);
    assert.equal(actual.lightChat.thinkingMode,light==='independent-light'?undefined:mode);
    assert.equal(actual.lightChat.model,light||config.model);
    assert.equal(actual.lightChat.baseUrl,config.baseUrl);
    assert.equal(aiConfig.getLightChatConfig().thinkingMode,undefined,'Other AI tasks keep their own configuration');
  }
});
function stream(){return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'合成回答'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}

test('RAG readiness reports invalid thinking without disabling other AI or probing network',()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected readiness probe');};
  try{
    const env={CHAT_API_URL:config.baseUrl,CHAT_API_KEY:config.apiKey,CHAT_MODEL:config.model};
    for(const mode of [undefined,'disabled','low'])assert.equal(inspectRagChatConfig({...env,RAG_DEEPSEEK_THINKING:mode}).configured,true);
    for(const bad of [{RAG_DEEPSEEK_THINKING:'private-invalid-mode'},{CHAT_API_URL:'https://proxy.invalid/chat',RAG_DEEPSEEK_THINKING:'low'}]){
      const configured={...env,...bad};assert.equal(inspectChatConfig(configured).configured,true);
      const state=inspectRagChatConfig(configured);assert.equal(state.configured,false);
      assert.equal(state.issues[0].field,'RAG_DEEPSEEK_THINKING');assert.ok(!JSON.stringify(state).includes('private-invalid-mode'));
    }
    assert.deepEqual(inspectRagChatConfig({...env,CHAT_API_URL:'invalid'}),inspectChatConfig({...env,CHAT_API_URL:'invalid'}));
  }finally{globalThis.fetch=previous;}
});

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
      if(body.tools)return agentAssessmentFixture('本次未找到能回答这个问题的记录。',body);
      return body.stream?stream():Response.json({choices:[{message:{content:'合成回答'},finish_reason:'stop'}]});
    };
    globalThis.fetch=transport;
    assert.equal(await requestChat(configured,messages),'合成回答');
    assert.equal(await streamRagAnswer(configured,messages,()=>{}),'合成回答');
    const run=new EvidenceRun(new AbortController().signal);
    const result=await supplementEvidence('合成问题',{strategy:'relevance'},run,{},createAgentModel(configured,transport),()=>{},undefined,{mode:'logs_only',history:[],chat:configured});
    assert.equal(result.kind,'answered');assert.equal(result.answer,'本次未找到能回答这个问题的记录。');assert.equal(bodies.length,3);
    for(const body of bodies){
      assert.deepEqual(body.thinking,mode?{type:mode==='low'?'enabled':'disabled'}:undefined);
      assert.equal(body.reasoning_effort,mode==='low'?'low':undefined);
      assert.ok(Array.isArray(body.messages));
    }
    assert.ok(bodies[2].tools.some(tool=>tool.function.name==='search'));
    assert.equal(bodies[2].tool_choice,mode==='disabled'?'required':'auto');
  }
});

test('required Agent tools are limited to the verified DeepSeek Flash disabled-thinking combination',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const [model,expected] of [['deepseek-flash','required'],['deepseek-v4-pro','auto']]){
    const configured=configureRagThinking({...config,model},{RAG_DEEPSEEK_THINKING:'disabled'}),bodies=[];
    const transport=async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return agentAssessmentFixture('本次未找到能回答这个问题的记录。',body);};
    globalThis.fetch=transport;
    const run=new EvidenceRun(new AbortController().signal);
    const result=await supplementEvidence('合成问题',{strategy:'relevance'},run,{},createAgentModel(configured,transport),()=>{},undefined,{mode:'logs_only',history:[],chat:configured});
    assert.equal(result.kind,'answered');assert.equal(bodies.length,1);assert.equal(bodies[0].tool_choice,expected);
  }
});
import { agentAssessmentFixture } from './rag-model-fixture.mjs';

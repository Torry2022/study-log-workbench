import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as config from '../lib/ai-config.ts';
const require=createRequire(import.meta.url);

test('actual capabilities handler disables only RAG for invalid thinking and reports safe diagnostics',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rag-capabilities-'));
  await fs.writeFile(path.join(root,'.instance.json'),JSON.stringify({schemaVersion:1,id:'b0250000-0000-4000-8000-000000000001'}));
  const keys=['CHAT_API_KEY','CHAT_API_URL','CHAT_MODEL','RAG_DEEPSEEK_THINKING'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('rag-capabilities-'));await fs.rm(root,{recursive:true,force:true});});
  globalThis.fetch=()=>{throw Error('Readiness must not call paid providers');};
  const source=await fs.readFile(new URL('../app/api/capabilities/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const exports={};
  runInNewContext(code,{exports,require:name=>{
    if(name==='@/lib/ai-config')return config;
    if(name==='@/lib/auth')return {requireAuth:()=>null};
    if(name==='@/lib/config')return {getLogRoot:()=>root};
    if(name==='@/lib/mcp-config')return {inspectMcpConfig:()=>({configured:true,issues:[]})};
    if(name==='@/lib/ai-prompts')return {inspectWritingPrompts:async()=>({generation:{configured:true},highlighting:{configured:true},extraction:{configured:true}})};
    if(name==='../../../package.json')return {version:'synthetic'};
    return require(name);
  }});
  for(const mode of [undefined,'disabled','low','private-invalid-mode']){
    Object.assign(process.env,{CHAT_API_KEY:'synthetic',CHAT_API_URL:'https://api.deepseek.com/chat/completions',CHAT_MODEL:'deepseek-flash'});
    if(mode===undefined)delete process.env.RAG_DEEPSEEK_THINKING;else process.env.RAG_DEEPSEEK_THINKING=mode;
    const response=await exports.GET({});assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.aiConfiguration.provider.configured,true);
    for(const feature of ['aiWriting','aiHighlighting','aiNoteExtraction','aiTaxonomy'])assert.equal(body.features[feature].configured,true);
    assert.equal(body.features.rag.configured,mode!=='private-invalid-mode');
    if(mode==='private-invalid-mode'){assert.equal(body.features.rag.issues[0].field,'RAG_DEEPSEEK_THINKING');assert.ok(!JSON.stringify(body).includes(mode));}
    else assert.deepEqual(body.features.rag.issues,[]);
  }
});

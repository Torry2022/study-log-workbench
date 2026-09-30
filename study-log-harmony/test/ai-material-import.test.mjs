import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await fs.readFile(new URL('../entry/src/main/ets/features/logs/LogAiMaterialImport.ets',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(uris,postFiles){
 const removed=[];const options=[];const uploaded=[];const module={exports:{}};
 runInNewContext(code,{module,exports:module.exports,Error,require(id){
  if(id==='@kit.CoreFileKit')return {fileIo:{unlinkSync:p=>removed.push(p)},picker:{DocumentSelectOptions:class{},DocumentViewPicker:class{async select(o){options.push(o);return uris;}}}};
  if(id.endsWith('/ApiClient'))return {apiClient:{postFiles:async(path,files)=>{uploaded.push(files[0].name);assert.equal(path,'/materials/extract');return postFiles(files[0]);}}};
  if(id.endsWith('/NoteImportFile'))return {cacheImportUri:(_ctx,uri)=>({path:'/cache/'+uri,name:uri,contentType:'text/plain'})};
  return {};
 }});
 return {importer:new module.exports.LogAiMaterialImport({}),removed,options,uploaded};
}
test('materials retain selection order, filenames and cache cleanup', async () => {
let release;const first=new Promise(resolve=>release=resolve);
const h=harness(['first.txt','second.md'],async f=>{if(f.name==='first.txt')await first;return {document:{fileName:f.name,text:f.name==='first.txt'?'FIRST':'SECOND',warnings:[]}};});
const pending=h.importer.pickAndExtract(()=>true);await new Promise(r=>setTimeout(r,0));
assert.deepEqual(h.uploaded,['first.txt']);release();const result=await pending;
assert.equal(result.text,'[文件：first.txt]\nFIRST\n\n[文件：second.md]\nSECOND');
assert.deepEqual(h.removed,['/cache/first.txt','/cache/second.md']);assert.equal(h.options[0].maxSelectNumber,5);
});
test('a failed material preserves successful siblings and cleans caches', async () => {
const failed=harness(['broken.txt','good.txt'],async f=>{if(f.name==='broken.txt')throw Error('synthetic interrupted upload');return {document:{fileName:f.name,text:'KEPT',warnings:[]}};});
const partial=await failed.importer.pickAndExtract(()=>true);assert.equal(partial.text,'[文件：good.txt]\nKEPT');assert.equal(partial.warnings[0],'synthetic interrupted upload');assert.equal(failed.removed.length,2);
});
test('invalidated material import discards late results and skips remaining uploads', async () => {
let active=true;let late;const delayed=new Promise(resolve=>late=resolve);
const stale=harness(['first.txt','second.txt'],async()=>{await delayed;return {document:{fileName:'first.txt',text:'STALE',warnings:[]}};});
const old=stale.importer.pickAndExtract(()=>active);await new Promise(r=>setTimeout(r,0));active=false;late();assert.equal(await old,undefined);assert.deepEqual(stale.uploaded,['first.txt']);assert.deepEqual(stale.removed,['/cache/first.txt']);
});
test('cancelled material picker makes no upload', async () => {
const cancelled=harness([],()=>{throw Error('unexpected upload');});assert.equal(await cancelled.importer.pickAndExtract(()=>true),undefined);assert.equal(cancelled.uploaded.length,0);
});

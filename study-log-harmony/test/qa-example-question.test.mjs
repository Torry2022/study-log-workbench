import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
const start = source.indexOf('  private useExampleQuestion(');
const end = source.indexOf('\n  }', start) + 4;
const module = {exports:{}};
runInNewContext(ts.transpileModule(`export class Page {${source.slice(start,end)}}`, {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{module,exports:module.exports});
test('example fills a draft without sending and cannot overwrite input or composition',()=>{
  const p=new module.exports.Page();let dirty=false;
  Object.assign(p,{data:{question:'',sending:false},composingQuestion:false,
    onDraftChange:value=>dirty=value,setComposerHidden(){},scheduleQuestionCaret(){},
    getUIContext:()=>({getFocusController:()=>({requestFocus(){}})})});
  p.useExampleQuestion('示例');assert.equal(p.data.question,'示例');assert.equal(dirty,true);
  p.useExampleQuestion('其他');assert.equal(p.data.question,'示例');
  for(const key of ['sending','composingQuestion']){
    p.data.question='';if(key==='sending')p.data.sending=true;else p.composingQuestion=true;
    p.useExampleQuestion('其他');assert.equal(p.data.question,'');p.data.sending=false;p.composingQuestion=false;
  }
});

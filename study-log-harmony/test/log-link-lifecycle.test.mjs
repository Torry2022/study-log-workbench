import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets',import.meta.url),'utf8');
const methods=['openLink','closeLink','finishLink'].map(name=>{
 const start=source.search(new RegExp(`^  private (?:async )?${name}\\(`,'m'));
 assert.ok(start>=0,name);
 const end=source.slice(start+1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
 return source.slice(start,start+1+end);
}).join('\n');
function subject(){
 const module={exports:{}};const releases=[],commands=[];
 runInNewContext(ts.transpileModule(`export class Page { ${methods} }`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
 const page=new module.exports.Page();
 Object.assign(page,{linkOpen:true,linkTarget:{documentKey:'2026-02-05'},lifecycle:1,editorReady:true,session:{selectedDate:'2026-02-05',day:{}},
 editor:{release:target=>new Promise(resolve=>releases.push({target,resolve})),command:async name=>commands.push(name)}});
 return {page,releases,commands};
}
test('link sheet closure retains capture until disappearance and blocks reopening during dismissal',async()=>{
 const {page,releases,commands}=subject();const target=page.linkTarget;
 page.closeLink();assert.equal(page.linkOpen,false);assert.equal(page.linkTarget,target);assert.equal(releases.length,0);
 await page.openLink();assert.deepEqual(commands,[]);
 page.finishLink();assert.equal(page.linkTarget,undefined);assert.equal(releases.length,1);
 releases[0].resolve();await Promise.resolve();assert.deepEqual(commands,['focus']);
 page.finishLink();assert.equal(releases.length,1);
});
test('unmount releases once without focus and a late release cannot focus a replacement page',async()=>{
 const first=subject();first.page.closeLink(false);assert.equal(first.releases.length,1);
 first.page.finishLink();first.releases[0].resolve();await Promise.resolve();assert.deepEqual(first.commands,[]);
 const second=subject();second.page.finishLink();second.page.lifecycle++;
 second.releases[0].resolve();await Promise.resolve();assert.deepEqual(second.commands,[]);
});

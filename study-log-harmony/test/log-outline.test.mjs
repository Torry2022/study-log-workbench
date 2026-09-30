import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const methods = ['locateOutlineHeading','outlineHeadings','showDesktopOutline','updateActiveOutline','openOutline','closeOutline'].map(name => {
  const start = source.indexOf(`  private ${name}(`);
  const end = source.slice(start + 1).search(/^  (?:private |@Builder|build\()/m);
  assert.ok(start >= 0 && end >= 0);return source.slice(start, start + 1 + end);
}).join('\n');
function subject() {
 const module = {exports:{}}, scheduled=[], scrolled=[], reveals=[], finishes=[];
 runInNewContext(ts.transpileModule(`export class Page { ${methods} }`, {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
 }).outputText,{module,exports:module.exports,WorkspaceBreakpoint:{EXTRA_LARGE:'xl'},ScrollAlign:{AUTO:0},setTimeout:fn=>scheduled.push(fn),
  revealPanel:(_context,valid,action)=>reveals.push(()=>{if(valid())action();}),
  Curve:{EaseIn:0},animateTo:(options,action)=>{action();finishes.push(options.onFinish);}});
 const page=new module.exports.Page();Object.assign(page,{workspaceBreakpoint:'xl',reading:{logsReadingMode:false},
  sourceMode:false,splitMode:false,activeOutlineId:'',activeOutlineIndex:0,lifecycle:1,
  session:{selectedDate:'2026-01-15',text:'### First\nbody\n### Second\nbody'},documents:{dayLoadRevision:1},previewText:'### First\nbody\n### Second\nbody',
  outlineMotionRevision:0,outlineRequestRevision:0,readerReady:true,
  favoritesData:{load(){}},getUIContext:()=>({}),
  desktopOutlineScroller:{scrollToIndex:(...args)=>scrolled.push(args)}});
 return {page,scheduled,scrolled,reveals,finishes};
}
test('visible desktop outline follows the active rendered heading using the original animated list scroll',()=>{
 const {page,scheduled,scrolled}=subject();page.updateActiveOutline('second');
 assert.equal(scheduled.length,1);scheduled[0]();assert.deepEqual(scrolled,[[1,true,0]]);
});
test('duplicate or unknown active-heading reports do not queue redundant outline scrolling',()=>{
 const {page,scheduled}=subject();page.updateActiveOutline('second');page.updateActiveOutline('second');page.updateActiveOutline('missing');assert.equal(scheduled.length,1);
});
test('queued outline scrolling is invalidated by another document, lifecycle, heading or hidden layout',()=>{
 for(const mutate of [p=>p.lifecycle++,p=>p.documents.dayLoadRevision++,p=>p.session.selectedDate='2026-01-17',p=>p.activeOutlineId='first',p=>p.reading.logsReadingMode=true,p=>p.splitMode=true]) {
  const {page,scheduled,scrolled}=subject();page.updateActiveOutline('second');assert.equal(scheduled.length,1);mutate(page);scheduled[0]();assert.equal(scrolled.length,0);
 }
});

test('duplicate outline titles retain their exact occurrence when selected',()=>{
 const {page}=subject();page.previewText='### Same\nfirst\n### Same\nsecond';page.targetRevision=0;page.readingOutlineOpen=true;
 let closed=false;page.closeOutline=()=>closed=true;
 page.locateOutlineHeading(page.outlineHeadings()[1]);
 assert.equal(page.activeOutlineId,'same-2');assert.equal(page.targetHeadingIndex,1);
 assert.equal(page.targetHeading,'Same');assert.equal(page.targetKind,'outline');assert.equal(page.targetRevision,1);
 assert.equal(closed,true);assert.equal(page.readingOutlineOpen,false);
});

test('opening the outline remeasures the preview heading or selects the first source heading',()=>{
 const {page}=subject();page.openOutline();assert.equal(page.outlineRequestRevision,1);
 page.openOutline();assert.equal(page.outlineRequestRevision,1,'already open does not repeat the request');
 for(const mode of ['source','not-ready']) {
  const {page}=subject();page.activeOutlineId='second';
  if(mode==='source')page.sourceMode=true;else page.readerReady=false;
  page.openOutline();assert.equal(page.activeOutlineId,'first');assert.equal(page.outlineRequestRevision,0);
 }
});

test('outline reveal and close callbacks from an unmounted view cannot mutate its state',()=>{
 const f=subject();f.page.openOutline();f.page.lifecycle++;f.reveals[0]();assert.equal(f.page.outlineOffset,340);
 const g=subject();g.page.outlineOpen=true;g.page.closeOutline();g.page.lifecycle++;g.finishes[0]();
 assert.equal(g.page.outlineOpen,true);
});

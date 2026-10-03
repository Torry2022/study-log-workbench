import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the component's actual event handlers; native dialogs and frame scheduling are controlled here.
const source = await readFile(new URL('../entry/src/main/ets/features/logs/LogsReaderPage.ets', import.meta.url), 'utf8');
const stateSource = (await readFile(new URL('../entry/src/main/ets/app/WorkspaceModuleState.ets', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('@Observed', '');
const rootSource = await readFile(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const notesSource = await readFile(new URL('../entry/src/main/ets/features/notes/NotesPage.ets', import.meta.url), 'utf8');
const statsSource = await readFile(new URL('../entry/src/main/ets/features/stats/StatsPage.ets', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../entry/src/main/ets/app/components/WorkspaceContent.ets', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../entry/src/main/ets/app/WorkspaceNavigationBridge.ets', import.meta.url), 'utf8');
function extract(text, names) {
 return names.map(name => {
  const start = text.search(new RegExp(`^  private (?:async )?${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing handler ${name}`);
  const end = text.slice(start + 1).search(/^  (?:private |@Builder|aboutTo|build\()/m);
  assert.ok(end >= 0, `Missing handler boundary ${name}`);
  return text.slice(start, start + 1 + end);
 }).join('\n');
}
const methods = extract(source, ['bindWorkspaceNavigation','isLogDocumentReady','logDocumentReady','logNavigationFailed',
 'selectedTab','selectTab','requestModule','confirmNotesLeave','confirmQaLeave','confirmTaxonomyLeave',
 'openTaxonomy','coverLogDocument','openLogSource']);
const rootMethods = extract(rootSource, ['openCurrentSearch','selectSearchResult','openLogSource','openNoteLink','openQaCitation','openFavorite','openStatsEntry','cancelNavigationPan', 'resetNavigationDrawer', 'resetSidebarMotion','resetReadingMode','registerWorkspaceNavigation','clearModuleNavigation','requestModule','switchModule',
 'openTaxonomy','switchQaSession','confirmQaDelete','revealModule','logDocumentReady','logNavigationFailed','confirmTaxonomyLeave','confirmNotesLeave','confirmQaLeave']);

function workspace(tab) {
  const dialogs = [], frames = [], targets = [];
  const module = { exports: {} };
  const code = ts.transpileModule(`${stateSource}
${bridgeSource.replace(/^import .*;\r?\n/gm, '')}
export class Root { ${rootMethods} }
export class Workspace { ${methods} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, $r: value => value,
    AppStorage: {get: () => false}, LoadingHintPlacement: class {}, AlertDialog: { show: value => dialogs.push(value) },
    setTimeout: fn => frames.push(fn), appFeedback: { show() {}, dismissScope() {} }, Curve: { EaseOut: 0 },
    FrameAction: class { constructor(action) { this.action = action; } } });
  const page = new module.exports.Workspace();
  const root = new module.exports.Root();
  Object.assign(page, {
    pendingLogDate: '', selectedModule: tab, moduleRequestedTab: -1, moduleSwitchRevision: 0, modules: new module.exports.WorkspaceModuleState(),
    targetRevision: 0, session: { text: 'saved', baseline: 'saved', isDirty: () => false },
    isWide: () => false, finishToolbarMotion() {}, closeNavigation() {}, closeOutline() {}, closeSearch() {},
    sidebar: {collapsedModules:[false,false,false,false,false],sidebarMotionRevision:0,sidebarAnimating:false}, reading: { logsReadingMode: false, readingProgress: 0 }, readingTransition: { clear() {} }, workspaceTransition: { clear() {}, finish() {} },
    qaNavigation: { loadQaNavigation() {} },
    confirmDiscard: action => action(),
    getUIContext: () => ({ getFocusController: () => ({ clearFocus() {} }), postFrameCallback: frame => frames.push(frame.action),
      animateTo: (options, action) => { action(); options.onFinish?.(); } }),
    loadTargetDate: async (date, action) => { targets.push(date); action(); }
  });
  Object.assign(root, {selectedModule:tab,modules:page.modules,moduleSwitchRevision:0,
    sidebar:page.sidebar,reading:page.reading,readingTransition:page.readingTransition,workspaceTransition:page.workspaceTransition,qaNavigation:page.qaNavigation,
    isWide:()=>page.isWide(),getUIContext:()=>page.getUIContext(),refreshNavigationLists:async()=>{}});
  for (const key of ['selectedModule','moduleSwitchRevision','workspaceTransition']) {
    Object.defineProperty(page,key,{get:()=>root[key],set:value=>root[key]=value,configurable:true});
  }
  for (const key of ['pendingLogDate','moduleRequestedTab','moduleReveal','outgoingTab']) {
    Object.defineProperty(page,key,{get:()=>root.modules[key],set:value=>root.modules[key]=value,configurable:true});
  }
  page.switchModule = (...args)=>root.switchModule(...args);
  page.onRegisterNavigation = view=>root.registerWorkspaceNavigation(view);
  page.bindWorkspaceNavigation();
  return { root, page, dialogs, frames, targets };
}

test('note source navigation preserves its module and draft until leave is accepted', () => {
  const { page, dialogs, targets } = workspace(1);
  page.modules.notesDirty = true;
  page.navigationCommands.noteLink('2026-01-15', 'sample');
  assert.equal(page.selectedModule, 1);
  assert.equal(targets.length, 0);
  dialogs[0].primaryButton.action();
  assert.equal(page.selectedModule, 1);
  assert.equal(page.modules.notesDirty, true);
  page.navigationCommands.noteLink('2026-01-15', 'sample');
  dialogs[1].secondaryButton.action();
  assert.equal(page.selectedModule, 0);
  assert.equal(page.modules.noteDiscardRevision, 1);
  assert.deepEqual(targets, ['2026-01-15']);
  assert.equal(page.targetHeading, 'sample');
});

test('citation navigation is blocked while streaming and protects pending answers', () => {
  const { page, dialogs, targets } = workspace(3);
  page.modules.qaBusy = true;
  page.navigationCommands.citation('2026-01-15', 'sample', 2);
  assert.equal(page.selectedModule, 3);
  assert.equal(targets.length, 0);
  page.modules.qaBusy = false;
  page.modules.qaPending = true;
  page.navigationCommands.citation('2026-01-15', 'sample', 2);
  dialogs[0].primaryButton.action();
  assert.equal(page.selectedModule, 3);
  assert.equal(page.modules.qaPending, true);
  page.navigationCommands.citation('2026-01-15', 'sample', 2);
  dialogs[1].secondaryButton.action();
  assert.equal(page.selectedModule, 0);
  assert.equal(page.modules.qaDiscardRevision, 1);
  assert.equal(page.targetHeadingIndex, 2);
});

test('favorite and statistics sources use the same module transition as navigation', () => {
  for (const tab of [2, 4]) {
    const { page, frames, targets } = workspace(tab);
    if (tab === 2) page.navigationCommands.favorite({ date: '2026-01-15', exists: true, headingText: 'sample', headingId: 'h2' });
    else page.navigationCommands.statsEntry({ date: '2026-01-15', rawHeading: 'sample', headingIndex: 2 });
    assert.equal(page.selectedModule, 0);
    assert.equal(page.outgoingTab, tab);
    assert.equal(page.moduleReveal, 0);
    assert.deepEqual(targets, ['2026-01-15']);
    assert.equal(frames.length, 0, 'wait for the requested document before revealing');
    page.logDocumentReady('2026-01-15');
    frames[0]();
    assert.equal(page.moduleReveal, 1);
    assert.equal(page.outgoingTab, -1);
  }
});

test('server leave checks do not change modules before the final action', () => {
  const { page, dialogs } = workspace(3);
  page.modules.notesDirty = true;
  let changed = false;
  page.confirmQaLeave(() => page.confirmNotesLeave(() => { changed = true; }));
  assert.equal(page.selectedModule, 3);
  dialogs[0].primaryButton.action();
  assert.equal(changed, false);
  assert.equal(page.selectedModule, 3);
});

test('late module capture cannot override a newer module selection', async () => {
  const { page } = workspace(0);
  const releases = [];
  page.isWide = () => true;
  page.workspaceTransition.cover = () => new Promise(resolve => releases.push(resolve));
  const old = page.switchModule(1, false, false);
  const latest = page.switchModule(4, false, false);
  releases[1]();
  await latest;
  releases[0]();
  await old;
  assert.equal(page.selectedModule, 4);
});

test('revisiting notes requests a list refresh through the mounted page', async () => {
  const { page } = workspace(0);
  assert.equal(page.modules.notesRefreshRevision, 0);
  await page.switchModule(1, false, false);
  assert.equal(page.modules.notesRefreshRevision, 1);
  await page.switchModule(0, false, false);
  await page.switchModule(1, false, false);
  assert.equal(page.modules.notesRefreshRevision, 2);

  assert.match(contentSource, /refreshRevision:\s*this\.modules\.notesRefreshRevision/);
  assert.match(notesSource, /@Prop @Watch\('refreshRevisionChanged'\) refreshRevision/);
  const module = { exports: {} };
  const code = ts.transpileModule(`export class Notes { ${extract(notesSource, ['refreshRevisionChanged'])} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { module, exports: module.exports });
  const notes = new module.exports.Notes();
  let loads = 0;
  notes.load = () => { loads += 1; };
  notes.refreshRevision = 0;
  notes.refreshRevisionChanged();
  assert.equal(loads, 0);
  notes.refreshRevision = page.modules.notesRefreshRevision;
  notes.refreshRevisionChanged();
  assert.equal(loads, 1);
});

test('revisiting statistics reloads months silently through the mounted page', async () => {
  const { page } = workspace(0);
  assert.equal(page.modules.statsVisitRevision, 0);
  await page.switchModule(4, false, false);
  assert.equal(page.modules.statsVisitRevision, 1);
  await page.switchModule(0, false, false);
  await page.switchModule(4, false, false);
  assert.equal(page.modules.statsVisitRevision, 2);

  assert.match(contentSource, /visitRevision:\s*this\.modules\.statsVisitRevision/);
  assert.match(statsSource, /@Prop @Watch\('visitRevisionChanged'\) visitRevision/);
  const module = { exports: {} };
  const code = ts.transpileModule(`export class Stats { ${extract(statsSource, ['visitRevisionChanged'])} }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { module, exports: module.exports });
  const stats = new module.exports.Stats();
  let loads = 0;
  stats.loadMonths = () => { loads += 1; };
  stats.visitRevision = 0;
  stats.visitRevisionChanged();
  assert.equal(loads, 0);
  stats.visitRevision = page.modules.statsVisitRevision;
  stats.visitRevisionChanged();
  assert.equal(loads, 1);
});

test('returning to logs refreshes navigation without replacing the open document', async () => {
  const { page, root } = workspace(1);
  page.session.selectedDate = '2026-02-05';
  let refreshes = 0;
  root.refreshNavigationLists = async () => { refreshes += 1; };
  const view = root.workspaceNavigationView;
  await page.switchModule(0, false, false);
  assert.equal(refreshes, 1);
  assert.equal(root.workspaceNavigationView, view);
  assert.equal(view.currentLogDate(), '2026-02-05');
});

test('clicking the current module cancels an in-flight departure through the actual tab entrypoint', async () => {
  const { page } = workspace(0);
  const releases = [];
  page.isWide = () => true;
  page.workspaceTransition.cover = () => new Promise(resolve => releases.push(resolve));
  page.selectTab(1);
  page.selectTab(0);
  assert.equal(releases.length, 2, 'return to the current module must supersede pending departure');
  releases[1]();
  await new Promise(resolve => setImmediate(resolve));
  releases[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.selectedModule, 0);
  assert.equal(page.moduleRequestedTab, -1);
});

test('taxonomy leave protects the workspace-owned draft and busy state before switching modules', () => {
  const { page, dialogs } = workspace(4);
  page.modules.taxonomyOpen = true;
  page.modules.taxonomyBusy = true;
  page.selectTab(1);
  assert.equal(page.selectedModule, 4);
  assert.equal(dialogs.length, 0);
  page.modules.taxonomyBusy = false;
  page.modules.taxonomyDirty = true;
  page.selectTab(1);
  dialogs[0].primaryButton.action();
  assert.equal(page.modules.taxonomyOpen, true);
  assert.equal(page.modules.taxonomyDirty, true);
  assert.equal(page.selectedModule, 4);
  page.selectTab(1);
  dialogs[1].secondaryButton.action();
  assert.equal(page.modules.taxonomyOpen, false);
  assert.equal(page.modules.taxonomyDirty, false);
  assert.equal(page.selectedModule, 1);
});


test('global search leaves non-log modules through the same unsaved-draft guard', () => {
  const { root, page, dialogs, targets } = workspace(1);
  page.modules.notesDirty = true;
  page.search = { searchQuery: 'sample', dismissSearchResults() {} };
  root.search = page.search;
  page.navigationCommands.searchResult({ date: '2026-01-15', matches: [], headings: [] });
  assert.equal(targets.length, 0, 'search must not navigate behind the unsaved note');
  assert.equal(dialogs.length, 1);
  dialogs[0].primaryButton.action();
  assert.equal(page.selectedModule, 1);
  page.navigationCommands.searchResult({ date: '2026-01-15', matches: [], headings: [] });
  dialogs[1].secondaryButton.action();
  assert.equal(page.selectedModule, 0);
  assert.deepEqual(targets, ['2026-01-15']);
});

test('document reads do not discard the covering source-module image', async () => {
  const { page } = workspace(2);
  const calls = [];
  page.workspaceTransition = { kind: 'module', waitingKind: 'module', snapshot: {},
    clear: () => calls.push('clear'), cover: kind => calls.push(kind) };
  await page.coverLogDocument();
  assert.deepEqual(calls, [], 'keep source module covered until the target document is ready');
});


test('cross-module reveal waits for the exact requested document, not the first scheduled frame', async () => {
  const { page, frames } = workspace(2);
  const finishes = [];
  page.isWide = () => true;
  page.workspaceTransition = { kind: 'module', snapshot: {}, clear() {}, cover: async () => {},
    finish: kind => finishes.push(kind) };
  await page.switchModule(0, false, false, () => {}, '2026-01-15');
  assert.equal(frames.length, 0);
  page.logDocumentReady('2026-02-05');
  assert.equal(frames.length, 0, 'old mounted preview must not reveal the target');
  page.logDocumentReady('2026-01-15');
  assert.equal(frames.length, 1); frames[0]();
  assert.deepEqual(finishes, ['module']);
});

test('failed target navigation releases the source cover and cannot release a newer target', async () => {
  const { page, frames } = workspace(4);
  await page.switchModule(0, false, false, () => {}, '2026-01-15');
  page.requestModule(0, false, false, () => {}, '2026-01-17');
  page.logNavigationFailed('2026-01-15');
  assert.equal(frames.length, 0);
  page.logNavigationFailed('2026-01-17'); frames[0]();
  assert.equal(page.moduleReveal, 1); assert.equal(page.outgoingTab, -1);
});

test('late reveal frame does not finish a newer module transition', async () => {
  const { page, frames } = workspace(2);
  await page.switchModule(0, false, false, () => {}, '2026-01-15');
  page.logDocumentReady('2026-01-15');
  await page.switchModule(1, false, false);
  frames[0](); assert.equal(page.moduleReveal, 0);
  frames[1](); assert.equal(page.moduleReveal, 1); assert.equal(page.selectedModule, 1);
});

test('already mounted target uses the readiness of the visible preview or source editor', async () => {
  for (const sourceMode of [false, true]) {
    const { page, frames } = workspace(2);
    Object.assign(page, { sourceMode, session: { selectedDate: '2026-01-15' },
      readerReady: !sourceMode, renderedPreviewDate: sourceMode ? '' : '2026-01-15',
      editorReady: sourceMode, editor: { loadedDocumentKey: '2026-01-15' } });
    await page.switchModule(0, false, false, () => {}, '2026-01-15');
    assert.equal(frames.length, 1); frames[0](); assert.equal(page.moduleReveal, 1);
  }
});


test('module navigation clears input focus only after the unsaved decision is accepted', () => {
  const { page, dialogs } = workspace(1);
  let cleared = 0; const context = page.getUIContext();
  page.getUIContext = () => ({ ...context, getFocusController: () => ({clearFocus: () => cleared++}) });
  page.modules.notesDirty = true;
  page.selectTab(2); dialogs[0].primaryButton.action(); assert.equal(cleared, 0);
  page.selectTab(2); dialogs[1].secondaryButton.action(); assert.equal(cleared, 1);
});


test('commands from an unmounted log view cannot navigate or dispose the newer workspace binding', () => {
 const {root,page}=workspace(1);const old=page.navigationCommands;page.bindWorkspaceNavigation();const current=root.workspaceNavigationView;
 old.request(2,false,false,()=>assert.fail('old callback executed'),'');old.dispose();
 assert.equal(root.selectedModule,1);assert.equal(root.workspaceNavigationView,current);
 root.modules.pendingLogDate='2026-01-15';old.ready('2026-01-15');assert.equal(root.modules.pendingLogDate,'2026-01-15');
 root.reading.workspaceOriginX = 7;old.readingOrigin({globalPosition:{x:99,y:99}});
 old.readingReady();old.readingViewport({});old.readingMode(true);old.sidebarCollapsed(true,-1);
 assert.equal(root.reading.workspaceOriginX,7);assert.equal(root.reading.logsReadingMode,false);
});
test('accepted stale note, QA and taxonomy prompts cannot discard a new workspace draft', () => {
 for(const kind of ['notes','qa','taxonomy']) {
  const {root,page,dialogs}=workspace(kind==='notes'?1:kind==='qa'?3:4);
  page.modules[kind+'Dirty']=true;if(kind==='taxonomy')page.modules.taxonomyOpen=true;
  page.selectTab(2);assert.equal(dialogs.length,1);page.bindWorkspaceNavigation();
  dialogs[0].secondaryButton.action();assert.equal(root.selectedModule,kind==='notes'?1:kind==='qa'?3:4);
  assert.equal(root.modules[kind+'Dirty'],true);
 }
});
test('a log leave decision resolved after rebinding cannot start an old module switch', () => {
 const {root,page}=workspace(0);let resume;page.confirmDiscard=action=>resume=action;
 page.selectTab(1);assert.ok(resume);page.bindWorkspaceNavigation();resume();assert.equal(root.selectedModule,0);
});
test('unmount invalidates pending capture and resets all application-owned transition state', async () => {
 const {root,page}=workspace(0);let release;page.isWide=()=>true;page.workspaceTransition.cover=()=>new Promise(resolve=>release=resolve);
 const pending=page.switchModule(1,false,false);page.navigationCommands.dispose();release();await pending;
 assert.equal(root.selectedModule,0);assert.equal(root.modules.moduleRequestedTab,-1);
 assert.equal(root.modules.pendingLogDate,'');assert.equal(root.modules.outgoingTab,-1);assert.equal(root.modules.moduleReveal,1);
});


test('QA session leave and delayed focus use the application binding and ignore an obsolete prompt', () => {
 const {root,page,dialogs,frames}=workspace(3);page.modules.qaDirty=true;
 page.navigationCommands.qaSession('history',true);dialogs[0].primaryButton.action();assert.equal(page.modules.qaSessionId,'');
 page.navigationCommands.qaSession('history',true);dialogs[1].secondaryButton.action();assert.equal(page.modules.qaSessionId,'history');
 const focus=page.modules.qaQuestionFocusRevision;page.bindWorkspaceNavigation();frames[0]();assert.equal(page.modules.qaQuestionFocusRevision,focus);
 page.modules.qaDirty=true;page.navigationCommands.qaSession('other');page.bindWorkspaceNavigation();dialogs[2].secondaryButton.action();assert.equal(root.modules.qaSessionId,'history');
});
test('QA deletion confirmed after workspace replacement cannot issue a request against the new instance', () => {
 const {root,page,dialogs}=workspace(3);let deleted=0;root.qaNavigation.deleteQaSession=()=>deleted++;
 page.navigationCommands.qaDelete({id:'old',title:'synthetic'});assert.equal(dialogs.length,1);page.bindWorkspaceNavigation();dialogs[0].secondaryButton.action();assert.equal(deleted,0);
 page.navigationCommands.qaDelete({id:'current',title:'synthetic'});dialogs[1].secondaryButton.action();assert.equal(deleted,1);
});


test('window resize policy survives question blur and focus transfer to workspace search', async () => {
 const qa = await readFile(new URL('../entry/src/main/ets/features/qa/QaPage.ets', import.meta.url), 'utf8');
 const start = rootSource.indexOf('  aboutToAppear(): void {');
 const end = rootSource.indexOf('  aboutToDisappear()', start);
 const module = { exports: {} };
 let mode = 0;
 const context = { setKeyboardAvoidMode(value) { mode = value; }, getKeyboardAvoidMode() { return mode; }, getHostContext() { return {}; } };
 const code = ts.transpileModule(`export class Root { ${rootSource.slice(start, end)} }
export class Qa { ${extract(qa, ['focusQuestion', 'blurQuestion'])} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
 }).outputText;
 runInNewContext(code, { module, exports: module.exports, KeyboardAvoidMode: { RESIZE: 1 },
  appFeedback: { attach() {} }, workspacePreferences: { initialize() {} }, apiClient: { setUnauthorizedHandler() {} } });
 const root = new module.exports.Root(); root.getUIContext = () => context; root.registerFonts = () => {};
 const page = new module.exports.Qa(); page.getUIContext = () => context; page.setComposerHidden = () => {};
 root.aboutToAppear(); assert.equal(mode, 1);
 page.focusQuestion(); page.blurQuestion();
 assert.equal(mode, 1, 'leaving composer must not restore OFFSET for the next input');
 assert.equal(page.questionFocused, false);
});

test('source commands cannot navigate after their view is replaced or disposed', () => {
  const {root, page, targets} = workspace(2);
  const stale = page.navigationCommands;
  page.bindWorkspaceNavigation();
  stale.citation('2026-01-15', 'old citation', 1);
  stale.noteLink('2026-01-15', 'old note');
  stale.favorite({ date: '2026-01-15', exists: false, id: 'old' });
  stale.statsEntry({ date: '2026-01-15', rawHeading: 'old stats', headingIndex: 1 });
  assert.deepEqual(targets, []);
  assert.equal(root.selectedModule, 2);
  page.navigationCommands.dispose();
  page.navigationCommands.noteLink('2026-01-15', 'disposed');
  assert.deepEqual(targets, []);
});

test('source leave confirmation cannot open the previous instance after rebinding', () => {
  const { page, dialogs, targets } = workspace(1);
  page.modules.notesDirty = true;
  page.navigationCommands.noteLink('2026-01-15', 'old instance');
  assert.equal(dialogs.length, 1);
  page.bindWorkspaceNavigation();
  dialogs[0].secondaryButton.action();
  assert.deepEqual(targets, []);
  assert.equal(page.selectedModule, 1);
  assert.equal(page.modules.notesDirty, true);
});

test('favorites retain resolved and missing heading identity while statistics retain raw headings', () => {
  for (const exists of [true, false]) {
    const { page, targets } = workspace(2);
    page.navigationCommands.favorite({ date:'2026-01-15', exists, id:'favorite-id',
      headingText:'same title', headingId:'old-heading', resolvedHeadingId:'resolved-heading' });
    assert.deepEqual(targets, ['2026-01-15']);
    assert.equal(page.targetHeading, exists ? 'same title' : '');
    assert.equal(page.targetHeadingId, exists ? 'resolved-heading' : 'missing-favorite-id');
    assert.equal(page.targetHeadingIndex, -1);
    assert.equal(page.targetKind, 'favorite');
  }
  const { page } = workspace(4);
  page.navigationCommands.statsEntry({ date:'2026-01-15', rawHeading:'1. **Raw title**', headingIndex:2 });
  assert.equal(page.targetHeading, '1. **Raw title**');
  assert.equal(page.targetHeadingIndex, 2);
  assert.equal(page.targetKind, 'stats');
});

test('search within the current log preserves its draft while another date requires confirmation', () => {
 const {root,page,targets}=workspace(0);const confirmations=[];
 root.search={searchQuery:'  sample  ',dismissSearchResults(){}};root.searchOpen=true;
 page.session.selectedDate='2026-01-15';page.confirmDiscard=action=>confirmations.push(action);
 page.navigationCommands.searchResult({date:'2026-01-15',matches:['### 1. sample'],headings:['sample']});
 assert.equal(confirmations.length,0);assert.equal(root.searchOpen,false);
 assert.equal(page.targetHeading,'sample');assert.equal(page.targetQuery,'sample');assert.equal(page.targetKind,'search');
 root.searchOpen=true;
 page.navigationCommands.searchResult({date:'2026-02-05',matches:[],headings:[]});
 assert.equal(confirmations.length,1);assert.deepEqual(targets,['2026-01-15']);assert.equal(root.searchOpen,true);
 confirmations[0]();assert.deepEqual(targets,['2026-01-15','2026-02-05']);assert.equal(root.searchOpen,false);
});

test('search confirmation and commands cannot act on a replacement view', () => {
 const {root,page,targets}=workspace(0);const confirmations=[];
 root.search={searchQuery:'sample',dismissSearchResults(){}};root.searchOpen=true;
 page.session.selectedDate='2026-01-15';page.confirmDiscard=action=>confirmations.push(action);
 const old=page.navigationCommands;
 old.searchResult({date:'2026-02-05',matches:[],headings:[]});
 page.bindWorkspaceNavigation();confirmations[0]();
 old.searchResult({date:'2026-02-05',matches:[],headings:[]});
 assert.deepEqual(targets,[]);assert.equal(root.searchOpen,true);
 page.navigationCommands.searchResult({date:'invalid',matches:[],headings:[]});
 assert.equal(confirmations.length,1);assert.deepEqual(targets,[]);
});


test('workspace actions are bound to the mounted view and server leave preserves all confirmations', () => {
 const {root,page,dialogs}=workspace(3);const calls=[];const logConfirm=[];
 root.openHelp=()=>calls.push('help');root.setTheme=value=>calls.push(value);root.changeServer=()=>calls.push('server');
 page.confirmDiscard=action=>logConfirm.push(action);
 const commands=page.navigationCommands;
 assert.equal(root.workspaceCommands, commands);
 commands.settings();commands.about();commands.help();commands.theme('dark');
 assert.equal(root.settingsOpen,true);assert.equal(root.aboutOpen,true);assert.deepEqual(calls,['help','dark']);
 page.modules.qaDirty=true;page.modules.notesDirty=true;commands.changeServer();
 assert.equal(dialogs.length,1);assert.equal(logConfirm.length,0);
 dialogs[0].secondaryButton.action();assert.equal(dialogs.length,2);assert.equal(logConfirm.length,0);
 dialogs[1].secondaryButton.action();assert.equal(logConfirm.length,1);assert.deepEqual(calls,['help','dark']);
 page.bindWorkspaceNavigation();logConfirm[0]();commands.help();commands.theme('light');commands.changeServer();
 assert.deepEqual(calls,['help','dark']);
 root.settingsOpen=false;root.aboutOpen=false;commands.settings();commands.about();
 assert.equal(root.settingsOpen,false);assert.equal(root.aboutOpen,false);
 page.navigationCommands.changeServer();assert.equal(logConfirm.length,2);logConfirm[1]();assert.deepEqual(calls,['help','dark','server']);
});

test('delayed log and history search focus cannot target a replacement workspace', () => {
 for(const tab of [0,3]){
  const {root,page,frames}=workspace(tab);
  root.search={changeLogSearchQuery(){}};root.searchFocusRevision=0;root.modules.qaSearchRevision=0;
  root.openNavigation=()=>root.sidebar.navigationOpen=true;
  page.navigationCommands.openSearch();assert.equal(frames.length,1);
  frames.shift()();assert.equal(tab===0?root.searchFocusRevision:root.modules.qaSearchRevision,1);
  page.navigationCommands.openSearch();page.bindWorkspaceNavigation();
  const before=tab===0?root.searchFocusRevision:root.modules.qaSearchRevision;
  frames.shift()();assert.equal(tab===0?root.searchFocusRevision:root.modules.qaSearchRevision,before);
 }
});


test('candidate busy gate blocks server leave before log confirmation and permits it after release', () => {
 const {root,page,dialogs}=workspace(1);const calls=[];
 root.changeServer=()=>calls.push('server');
 page.confirmDiscard=action=>{calls.push('log-confirm');action();};
 page.modules.notesBusy=true;
 page.navigationCommands.changeServer();
 assert.deepEqual(calls,[]);assert.equal(dialogs.length,0);
 page.modules.notesBusy=false;
 page.navigationCommands.changeServer();
 assert.deepEqual(calls,['log-confirm','server']);
});

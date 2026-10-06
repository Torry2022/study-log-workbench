import { EditorState, Prec, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, undo, redo, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { createSearchPanel } from './search-panel.js';
import { serializeContinuation, deserializeContinuation } from './continuation-state.js';
import { formatMarkdown } from './markdown-menu.js';

let view, documentKey = '', revision = 0, timer, pending = false;
let bookmarkSequence = 0;
let transferringImages = false;
let continuationLease = '';
const continuationLock = new Compartment();
const bookmarks = new Map();
const wrapping = new Compartment();
let editorWrap = true;
window.setEditorPreferences = (size, wrap) => {
  if (![12, 14, 16, 18, 20].includes(size) || typeof wrap !== 'boolean') return;
  document.documentElement.style.setProperty('--editor-font-size', `${size}px`);
  editorWrap = wrap;
  if (view) view.dispatch({ effects:wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
};
const send = event => window.editorBridge?.message(JSON.stringify({ documentKey, revision, ...event }));
const snapshot = () => ({ documentKey, revision, text: view.state.doc.toString(),
  from: view.state.selection.main.from, to: view.state.selection.main.to });
const publish = () => { clearTimeout(timer); pending = false; send({ type:'change', ...snapshot() }); };
const action = command => { send({ type:'command', command }); return true; };
function captureTarget(from = view.state.selection.main.from, to = view.state.selection.main.to) {
  const bookmark = String(++bookmarkSequence);
  bookmarks.set(bookmark, { from, to });
  return { ...snapshot(), from, to, bookmark };
}
async function transferImages(files, position) {
  if (!files.length) return;
  if (continuationLease) { send({ type:'notice', error:'正在接续，请先确认接续结果' }); return; }
  if (transferringImages) { send({ type:'notice', error:'请等待当前图片传输完成' }); return; }
  transferringImages = true;
  const key = documentKey;
  let target;
  try {
    if (files.length > 5 || files.some(file => !/^image\/(png|jpeg|gif|webp)$/.test(file.type)))
      throw new Error('一次最多插入 5 张 PNG、JPEG、GIF 或 WebP 图片');
    if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024)
      throw new Error('一次粘贴或拖入的图片总大小不能超过 20 MiB');
    await settleInput();
    if (key !== documentKey) return;
    target = position == null ? captureTarget() : captureTarget(position, position);
    const chunk = packet => {
      if (key !== documentKey || !window.editorBridge?.imageChunk(JSON.stringify({ documentKey:key, ...packet })))
        throw new Error('图片传输已取消或日块已切换');
    };
    chunk({ type:'begin', target, count:files.length });
    for (const file of files) {
      chunk({ type:'file', mime:file.type });
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 24576) {
        chunk({ type:'chunk', data:btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))) });
      }
    }
    chunk({ type:'end' });
  } catch (error) {
    window.editorBridge?.imageChunk(JSON.stringify({ documentKey:key, type:'abort' }));
    if (target) bookmarks.delete(target.bookmark);
    send({ type:'notice', error:error.message });
  } finally { transferringImages = false; }
}
const style = EditorView.theme({
  '&': { height:'100%', backgroundColor:'var(--surface-dark-soft)', color:'var(--on-dark)' },
  '&.cm-focused': { outline:'none' },
  '.cm-scroller': { fontFamily:'"JetBrains Mono", monospace', fontSize:'var(--editor-font-size, 14px)', lineHeight:'1.65', overflow:'auto' },
  '.cm-content': { padding:'12px 0', caretColor:'var(--on-dark)' },
  '.cm-line': { padding:'0 12px' },
  '.cm-gutters': { backgroundColor:'var(--surface-dark-soft)', color:'var(--on-dark-soft)', borderRight:'1px solid rgba(250,249,245,.1)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor:'rgba(250,249,245,.06)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor:'rgba(204,120,92,.34)' },
  '.cm-cursor': { borderLeftColor:'var(--on-dark)' },
  '.cm-panels': { backgroundColor:'var(--surface-dark-soft)', color:'var(--on-dark)' },
  '.cm-textfield, .cm-button': { background:'var(--surface-dark-soft)', color:'var(--on-dark)', border:'1px solid rgba(250,249,245,.2)' }
}, { dark:true });
const highlight = HighlightStyle.define([
  { tag:tags.heading, color:'#faf9f5', fontWeight:'bold' },
  { tag:tags.strong, fontWeight:'bold' }, { tag:tags.emphasis, fontStyle:'italic' },
  { tag:[tags.link, tags.url], color:'#cc785c' }, { tag:tags.monospace, color:'#e8a55a' },
  { tag:tags.meta, color:'#a09d96' }
]);
function wrap(marker, fallback) {
  const { from, to } = view.state.selection.main;
  const original = view.state.sliceDoc(from, to) || fallback;
  const marked = original.startsWith(marker) && original.endsWith(marker) && original.length >= marker.length * 2;
  const insert = marked ? original.slice(marker.length, -marker.length) : marker + original + marker;
  view.dispatch({ changes:{ from, to, insert }, selection:{ anchor:from + (marked ? 0 : marker.length),
    head:from + insert.length - (marked ? 0 : marker.length) }, userEvent:'input' });
  return true;
}
function heading() {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from), last = view.state.doc.lineAt(selection.to);
  const insert = view.state.sliceDoc(first.from, last.to).split('\n').map(line =>
    line.startsWith('### ') ? line.slice(4) : '### ' + line.replace(/^#{1,6}\s+/, '')).join('\n');
  view.dispatch({ changes:{ from:first.from, to:last.to, insert }, userEvent:'input' });
  return true;
}
const shortcuts = [
  { key:'Mod-Shift-z', run:redo },
  { key:'Mod-s', run:() => action('save') },
  { key:'Mod-b', run:() => wrap('**', '加粗文本') }, { key:'Mod-i', run:() => wrap('*', '斜体文本') },
  { key:'Mod-`', run:() => wrap('`', '代码') }, { key:'Mod-k', run:() => { wrapLink(); return true; } },
  { key:'Mod-Shift-k', run:() => action('internalLink') },
  { key:'Ctrl-Alt-3', run:heading }, { key:'Tab', run:indentMore }, { key:'Shift-Tab', run:indentLess },
  { key:'Mod-Shift-f', run:() => action('globalSearch') }
];
function wrapLink() {
  const { from, to } = view.state.selection.main;
  const label = view.state.sliceDoc(from, to) || '链接文本';
  const insert = `[${label}](https://)`;
  view.dispatch({ changes:{ from, to, insert }, selection:{ anchor:from + label.length + 3,
    head:from + insert.length - 1 }, userEvent:'input' });
}
function extensions() {
  return [continuationLock.of([]), EditorState.transactionFilter.of(transaction =>
    continuationLease && transaction.docChanged ? [] : transaction),
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(),
    bracketMatching(), closeBrackets(), autocompletion(), markdown(), indentUnit.of('  '), wrapping.of(editorWrap ? EditorView.lineWrapping : []),
    placeholder('记录今天的学习内容'), search({ top:true, createPanel:createSearchPanel }), highlightSelectionMatches(),
    EditorState.phrases.of({ Find:'查找', Replace:'替换', next:'下一个', previous:'上一个', all:'全选',
      'match case':'区分大小写', regexp:'正则表达式', 'by word':'全字匹配', replace:'替换', 'replace all':'全部替换', close:'关闭' }),
    style, syntaxHighlighting(highlight), Prec.high(keymap.of(shortcuts)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap,
      ...searchKeymap]),
    EditorView.domEventHandlers({
      paste(event) {
        const files = Array.from(event.clipboardData?.files || []);
        if (!files.length) return false;
        event.preventDefault(); transferImages(files); return true;
      },
      drop(event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault(); transferImages(files, view.posAtCoords({ x:event.clientX, y:event.clientY })); return true;
      }
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      for (const target of bookmarks.values()) {
        update.changes.iterChangedRanges((from, to) => {
          if (from < target.to && to > target.from) target.invalid = true;
        });
        target.from = update.changes.mapPos(target.from, 1);
        target.to = update.changes.mapPos(target.to, 1);
      }
      revision++;
      if (!pending) { pending = true; send({ type:'dirty' }); }
      clearTimeout(timer); timer = setTimeout(publish, 80);
    })];
}
async function settleInput() {
  if (!view?.composing) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { view.contentDOM.removeEventListener('compositionend', ended); reject(new Error('请先完成当前中文输入')); }, 10000);
    function ended() { clearTimeout(timeout); setTimeout(resolve, 0); }
    view.contentDOM.addEventListener('compositionend', ended, { once:true });
  });
}
window.editorRequest = async request => {
  try {
    if (continuationLease && !['snapshot', 'resumeContinuation', 'blur'].includes(request.action))
      throw new Error('正在接续，请先确认接续结果');
    if (request.action !== 'load') {
      if (!view || request.documentKey !== documentKey) throw new Error('编辑文档已变化');
      await settleInput();
      if (request.documentKey !== documentKey) throw new Error('编辑文档已变化');
      if (continuationLease && !['snapshot', 'resumeContinuation', 'blur'].includes(request.action))
        throw new Error('正在接续，请先确认接续结果');
    }
    if (request.action === 'captureContinuation') {
      if (transferringImages || bookmarks.size) throw new Error('请先完成或取消待插入内容');
      if (typeof request.lease !== 'string' || !/^[a-f0-9]{32}$/.test(request.lease)) throw new Error('无效接续会话');
      const continuation = serializeContinuation(view.state, view.scrollDOM.scrollTop, view.scrollDOM.scrollLeft);
      continuationLease = request.lease;
      view.dispatch({ effects:continuationLock.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)]) });
      publish();
      send({ type:'result', requestId:request.requestId, ...snapshot(), continuation });
      return;
    } else if (request.action === 'resumeContinuation') {
      if (!continuationLease || continuationLease !== request.lease) throw new Error('接续会话已变化');
      continuationLease = '';
      view.dispatch({ effects:continuationLock.reconfigure([]) });
    } else if (request.action === 'restoreContinuation') {
      if (request.expectedRevision !== revision || transferringImages || bookmarks.size)
        throw new Error('本机编辑已变化，不能覆盖');
      const restored = deserializeContinuation(request.continuation, extensions());
      clearTimeout(timer); pending = false;
      view.setState(restored.state);
      revision++;
      const restoredRevision = revision;
      await new Promise(resolve => requestAnimationFrame(() => {
        if (view.state === restored.state && request.documentKey === documentKey) {
          view.scrollDOM.scrollTop = restored.scrollTop;
          view.scrollDOM.scrollLeft = restored.scrollLeft;
        }
        resolve();
      }));
      if (request.documentKey !== documentKey || revision !== restoredRevision || view.state !== restored.state)
        throw new Error('恢复期间编辑已变化，请重新确认');
    } else if (request.action === 'load') {
      clearTimeout(timer); pending = false; documentKey = request.documentKey; revision = 0; bookmarks.clear();
      const state = EditorState.create({ doc:request.text || '', extensions:extensions() });
      if (view) view.setState(state); else view = new EditorView({ state, parent:document.querySelector('#editor') });
      const date = document.querySelector('#date');
      date.replaceChildren(Object.assign(document.createElement('span'), { textContent:'##' }), document.createTextNode(' ' + request.date));
      view.scrollDOM.scrollTop = 0;
    } else if (request.action === 'replace') {
      if (request.resetHistory) {
        bookmarks.clear();
        view.setState(EditorState.create({ doc:request.text, extensions:extensions() })); revision++; publish();
      } else view.dispatch({ changes:{ from:0, to:view.state.doc.length, insert:request.text }, annotations:isolateHistory.of('full'), userEvent:'input' });
    } else if (request.action === 'insert') {
      const target = request.bookmark ? bookmarks.get(request.bookmark) : request;
      if (!target || target.invalid || (!request.bookmark && request.expectedRevision !== revision))
        throw new Error('插入位置的内容已变化，请重新插入');
      const { from, to } = target, { text } = request;
      if (request.bookmark) bookmarks.delete(request.bookmark);
      view.dispatch({ changes:{ from, to, insert:text }, selection:{ anchor:from + text.length }, scrollIntoView:true,
        annotations:isolateHistory.of('full'), userEvent:'input' });
      view.focus();
    } else if (request.action === 'capture') {
      send({ type:'result', requestId:request.requestId, ...captureTarget() });
      return;
    } else if (request.action === 'release') bookmarks.delete(request.bookmark);
    else if (request.action === 'focus') view.focus();
    else if (request.action === 'blur') view.contentDOM.blur();
    else if (request.action.startsWith('format:')) {
      if (!formatMarkdown(view, request.action.slice(7))) throw new Error('请先完成当前输入');
    }
    else if (request.action === 'undo') undo(view);
    else if (request.action === 'redo') redo(view);
    else if (request.action === 'find') { openSearchPanel(view); view.requestMeasure(); }
    else if (request.action !== 'snapshot') throw new Error('不支持的编辑命令');
    publish();
    send({ type:'result', requestId:request.requestId, ...snapshot() });
  } catch (error) { send({ type:'result', requestId:request.requestId, error:String(error.message || error) }); }
};
window.addEventListener('error', () => send({ type:'failed', error:'编辑器运行失败' }));
send({ type:'ready' });

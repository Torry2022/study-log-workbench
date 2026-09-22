import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { captureReadingPosition, restoreReadingPosition } from "../lib/reading-position.ts";

function environment(scrollY = 200) {
  const body = { parentElement: null };
  globalThis.document = { body, documentElement: { scrollHeight: 5000 } };
  globalThis.window = {
    scrollY, innerHeight: 800,
    getComputedStyle: element => ({ overflowY: element.overflow || "visible" }),
    scrollTo: ({ top }) => { window.scrollY = Math.max(0, Math.min(4200, top)); }
  };
  return body;
}

function element(top, height, parent = document.body, extra = {}) {
  const node = {
    isConnected: true, parentElement: parent, dataset: {}, scrollTop: 0,
    scrollHeight: height, clientHeight: height, children: [], ...extra,
    getBoundingClientRect() {
      let offset = window.scrollY;
      for (let ancestor = node.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) offset += ancestor.scrollTop;
      return { top: top - offset, bottom: top - offset + height, height };
    },
    querySelectorAll() { return node.children; },
    scrollTo({ top }) { node.scrollTop = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, top)); }
  };
  return node;
}
const block = (parent, top, height, start, end) => element(top, height, parent, { dataset: { sourceStartOffset: String(start), sourceEndOffset: String(end) } });
const options = (preview, editor = null) => ({ preview: () => preview, editor: () => editor, toolbarBottom: () => 88 });

function editor(doc, top = 100, innerScroll = false) {
  const state = EditorState.create({ doc });
  const dom = element(top, innerScroll ? 300 : state.doc.lines * 20 + 24, document.body, {
    overflow: innerScroll ? "auto" : "visible", scrollHeight: state.doc.lines * 20 + 24
  });
  const lineBlock = line => ({ from: line.from, to: line.to, top: (line.number - 1) * 20, height: 20 });
  return {
    dom, scrollDOM: dom, state,
    get documentTop() { return dom.getBoundingClientRect().top + 12 - dom.scrollTop; },
    lineBlockAtHeight(height) { return lineBlock(state.doc.line(Math.min(state.doc.lines, Math.max(1, Math.floor(height / 20) + 1)))); },
    lineBlockAt(offset) { return lineBlock(state.doc.lineAt(offset)); },
    requestMeasure() {}
  };
}

test("capture chooses the smallest nested Markdown block crossing the toolbar", () => {
  environment();
  const preview = element(100, 1000);
  preview.children = [block(preview, 150, 700, 0, 1000), block(preview, 280, 80, 100, 200)];
  const anchor = captureReadingPosition(options(preview), "preview");
  assert.equal(anchor.kind, "content");
  assert.equal(anchor.sourceOffset, 125);
  assert.equal(anchor.blockProgress, 0.25);
});

test("restore uses the target source block after its rendered height changes", () => {
  environment();
  const preview = element(100, 1400);
  preview.children = [block(preview, 150, 1000, 0, 1000), block(preview, 700, 200, 100, 200)];
  assert.equal(restoreReadingPosition(options(preview), { kind: "content", sourceOffset: 125, blockProgress: 0.25, documentProgress: 0.99 }, "preview"), true);
  assert.equal(window.scrollY, 650); // 700 + 25% * 200 - toolbar landing 100
});

test("nested split preview changes its own scrollTop, not document scroll", () => {
  environment(100);
  const scroller = element(200, 400, document.body, { overflow: "auto", scrollHeight: 1800, scrollTop: 350 });
  const preview = element(200, 1800, scroller);
  preview.children = [block(preview, 600, 120, 100, 200)];
  assert.equal(restoreReadingPosition(options(preview), { kind: "content", sourceOffset: 150, blockProgress: 0.5, documentProgress: 0 }, "preview"), true);
  assert.equal(scroller.scrollTop, 460);
  assert.equal(window.scrollY, 100);
});

test("source capture includes documentTop padding and window scroll, skipping blank lines", () => {
  environment(52);
  const view = editor("one\ntwo\n\nfour\nfive\nsix");
  // Landing 100 minus documentTop 60 = 40: the third (blank) line.
  const anchor = captureReadingPosition(options(null, view), "source");
  assert.equal(anchor.kind, "content");
  assert.equal(anchor.sourceOffset, view.state.doc.line(4).from);
  assert.equal(anchor.blockProgress, 0);
});

test("source restore derives progress from the target line, not the preview block ratio", () => {
  environment(200);
  const view = editor(Array.from({ length: 40 }, () => "abcdefghij").join("\n"));
  const offset = view.state.doc.line(20).from + 5;
  const anchor = { kind: "content", sourceOffset: offset, blockProgress: 0.9, documentProgress: 0.99 };
  assert.equal(restoreReadingPosition(options(null, view), anchor, "source"), true);
  assert.equal(window.scrollY, 402); // content top 112 + line top 380 + half-line 10 - landing 100
  assert.equal(captureReadingPosition(options(null, view), "source").sourceOffset, offset);
});

test("source restore in a scrollable editor uses inner scroll and keeps window position", () => {
  environment(100);
  const view = editor(Array.from({ length: 80 }, () => "abcdefghij").join("\n"), 200, true);
  const offset = view.state.doc.line(30).from;
  assert.equal(restoreReadingPosition(options(null, view), { kind: "content", sourceOffset: offset, blockProgress: 0, documentProgress: 0 }, "source"), true);
  assert.equal(view.scrollDOM.scrollTop, 592);
  assert.equal(window.scrollY, 100);
});

test("source whitespace gaps restore to nearby preview content before using fallback", () => {
  environment();
  const preview = element(100, 1400);
  preview.children = [block(preview, 300, 80, 0, 40), block(preview, 900, 80, 50, 100)];
  restoreReadingPosition(options(preview), { kind: "content", sourceOffset: 48, blockProgress: 0, documentProgress: 0.01 }, "preview");
  assert.equal(window.scrollY, 800);
});

test("fallback, top and hidden target handling do not claim missing geometry is restored", () => {
  environment();
  const preview = element(100, 1000);
  restoreReadingPosition(options(preview), { kind: "progress", documentProgress: 0.5 }, "preview");
  assert.equal(window.scrollY, 2100);
  restoreReadingPosition(options(preview), { kind: "top" }, "preview");
  assert.equal(window.scrollY, 0);
  assert.deepEqual(captureReadingPosition(options(preview), "preview"), { kind: "top" });
  assert.equal(restoreReadingPosition(options(element(100, 0)), { kind: "top" }, "preview"), false);
});

test("narrow split with hidden preview captures and restores the visible source", () => {
  environment(200);
  const view = editor(Array.from({ length: 40 }, () => "abcdefghij").join("\n"));
  const settings = options(element(100, 0), view);
  const anchor = captureReadingPosition(settings, "split");
  assert.equal(anchor.kind, "content");
  window.scrollY = 10;
  assert.equal(restoreReadingPosition(settings, anchor, "split"), true);
  assert.equal(captureReadingPosition(settings, "source").sourceOffset, anchor.sourceOffset);
});

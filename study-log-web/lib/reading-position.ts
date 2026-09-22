import type { EditorView } from "@codemirror/view";

export type ReadingMode = "preview" | "source" | "split";
export type ReadingAnchor =
  | { kind: "top" }
  | { kind: "progress"; documentProgress: number }
  | { kind: "content"; sourceOffset: number; blockProgress: number; documentProgress: number };

export interface ReadingPositionOptions {
  editor: () => EditorView | null;
  preview: () => HTMLElement | null;
  toolbarBottom: () => number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const visible = (element: HTMLElement | null): element is HTMLElement => Boolean(element?.isConnected && element.getBoundingClientRect().height > 0);
const range = (element: HTMLElement) => ({ start: Number(element.dataset.sourceStartOffset), end: Number(element.dataset.sourceEndOffset) });
const windowRange = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

function scrollRoot(element: HTMLElement): HTMLElement | null {
  for (let current: HTMLElement | null = element; current && current !== document.body; current = current.parentElement) {
    if (current.scrollHeight > current.clientHeight + 2 && /auto|scroll|overlay/.test(window.getComputedStyle(current).overflowY)) return current;
  }
  return null;
}

function anchorLine(options: ReadingPositionOptions, root: HTMLElement | null): number {
  const line = Math.ceil(options.toolbarBottom()) + 12;
  if (!root) return line;
  const rect = root.getBoundingClientRect();
  return clamp(line, rect.top, rect.top + Math.max(0, root.clientHeight - 1));
}

function progress(root: HTMLElement | null): number {
  return root
    ? clamp(root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight), 0, 1)
    : clamp(window.scrollY / Math.max(1, windowRange()), 0, 1);
}

function blocks(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>("[data-source-block='true']")).filter(block => {
    const { start, end } = range(block);
    return block.dataset.sourceStartOffset !== undefined && block.dataset.sourceEndOffset !== undefined &&
      Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && visible(block);
  });
}

const smallestFirst = (left: HTMLElement, right: HTMLElement) => {
  const a = range(left), b = range(right);
  return (a.end - a.start) - (b.end - b.start);
};

function previewBlockAtLine(element: HTMLElement, line: number): HTMLElement | undefined {
  const candidates = blocks(element);
  const crossing = candidates.filter(block => {
    const rect = block.getBoundingClientRect();
    return rect.top <= line && rect.bottom >= line;
  }).sort(smallestFirst);
  return crossing[0] || candidates.filter(block => block.getBoundingClientRect().bottom > line)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
}

export function captureReadingPosition(options: ReadingPositionOptions, mode: ReadingMode): ReadingAnchor {
  const preview = options.preview();
  // A narrow split layout hides the preview; its source pane is the reader.
  const useSource = mode === "source" || (mode === "split" && !visible(preview));
  const view = options.editor();
  const surface = useSource ? view?.scrollDOM || null : preview;
  const root = surface ? scrollRoot(surface) : null;
  const documentProgress = progress(root);
  if (Math.max(window.scrollY, root?.scrollTop || 0) <= 2) return { kind: "top" };
  const line = anchorLine(options, root);

  if (useSource && view && visible(view.dom)) {
    // CodeMirror heights start at documentTop, including window scrolling and
    // editor padding; scrollTop alone is not a document coordinate.
    const height = Math.max(0, line - view.documentTop);
    const block = view.lineBlockAtHeight(height);
    const sourceLine = view.state.doc.lineAt(block.from);
    if (!sourceLine.text.trim()) {
      for (let distance = 1; distance < view.state.doc.lines; distance++) {
        for (const number of [sourceLine.number + distance, sourceLine.number - distance]) {
          if (number < 1 || number > view.state.doc.lines) continue;
          const adjacent = view.state.doc.line(number);
          if (adjacent.text.trim()) return { kind: "content", sourceOffset: adjacent.from, blockProgress: 0, documentProgress };
        }
      }
    }
    const blockProgress = clamp((height - block.top) / Math.max(1, block.height), 0, 1);
    return { kind: "content", sourceOffset: Math.round(block.from + blockProgress * (block.to - block.from)), blockProgress, documentProgress };
  }

  if (!useSource && visible(preview)) {
    const block = previewBlockAtLine(preview, line);
    if (block) {
      const rect = block.getBoundingClientRect();
      const { start, end } = range(block);
      const blockProgress = clamp((line - rect.top) / Math.max(1, rect.height), 0, 1);
      return { kind: "content", sourceOffset: Math.round(start + blockProgress * (end - start)), blockProgress, documentProgress };
    }
  }
  return { kind: "progress", documentProgress };
}

function restoreProgress(root: HTMLElement | null, value: number) {
  if (root) root.scrollTo({ top: Math.max(0, root.scrollHeight - root.clientHeight) * value, behavior: "auto" });
  else window.scrollTo({ top: windowRange() * value, behavior: "auto" });
}

function restorePreview(options: ReadingPositionOptions, anchor: ReadingAnchor): boolean {
  const preview = options.preview();
  if (!visible(preview)) return false;
  const root = scrollRoot(preview);
  if (anchor.kind === "top") {
    window.scrollTo({ top: 0, behavior: "auto" });
    root?.scrollTo({ top: 0, behavior: "auto" });
    return true;
  }
  if (anchor.kind === "progress") { restoreProgress(root, anchor.documentProgress); return true; }
  const candidates = blocks(preview);
  const containing = candidates.filter(block => {
    const { start, end } = range(block);
    return start <= anchor.sourceOffset && end >= anchor.sourceOffset;
  }).sort(smallestFirst);
  // Whitespace between blocks still has a meaningful nearest source block.
  const distance = (block: HTMLElement) => { const { start, end } = range(block); return Math.min(Math.abs(start - anchor.sourceOffset), Math.abs(end - anchor.sourceOffset)); };
  const block = containing[0] || candidates.sort((a, b) => distance(a) - distance(b) || smallestFirst(a, b))[0];
  if (!block) { restoreProgress(root, anchor.documentProgress); return true; }
  const { start, end } = range(block);
  const blockProgress = end > start ? clamp((anchor.sourceOffset - start) / (end - start), 0, 1) : anchor.blockProgress;
  const rect = block.getBoundingClientRect();
  const delta = rect.top + blockProgress * rect.height - anchorLine(options, root);
  if (root) root.scrollTo({ top: Math.max(0, root.scrollTop + delta), behavior: "auto" });
  else window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "auto" });
  return true;
}

function restoreSource(options: ReadingPositionOptions, anchor: ReadingAnchor, alignWindow: boolean): boolean {
  const view = options.editor();
  if (!view || !visible(view.dom)) return false;
  const root = scrollRoot(view.scrollDOM);
  if (anchor.kind === "top") {
    if (alignWindow) window.scrollTo({ top: 0, behavior: "auto" });
    root?.scrollTo({ top: 0, behavior: "auto" });
    return true;
  }
  if (anchor.kind === "progress") { if (root || alignWindow) restoreProgress(root, anchor.documentProgress); return true; }
  const position = clamp(anchor.sourceOffset, 0, view.state.doc.length);
  const block = view.lineBlockAt(position);
  const blockProgress = block.to > block.from ? clamp((position - block.from) / (block.to - block.from), 0, 1) : 0;
  const delta = view.documentTop + block.top + blockProgress * block.height - anchorLine(options, root);
  if (root) root.scrollTo({ top: Math.max(0, root.scrollTop + delta), behavior: "auto" });
  // In a split layout the preview owns window scrolling. With an expanding
  // source editor there may be no inner scroll range to adjust independently.
  if (alignWindow) {
    const remaining = view.documentTop + block.top + blockProgress * block.height - anchorLine(options, null);
    window.scrollTo({ top: Math.max(0, window.scrollY + remaining), behavior: "auto" });
  }
  view.requestMeasure();
  return true;
}

export function restoreReadingPosition(options: ReadingPositionOptions, anchor: ReadingAnchor, mode: ReadingMode): boolean {
  if (mode === "preview") return restorePreview(options, anchor);
  if (mode === "source" || !visible(options.preview())) return restoreSource(options, anchor, true);
  const restored = restorePreview(options, anchor);
  return restoreSource(options, anchor, false) && restored;
}

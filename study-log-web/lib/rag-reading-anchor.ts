export interface RagReadingAnchor {
  preview: Element;
  block: Element;
  source: string | null;
  tag: string;
  path: number[];
  offset: number;
  top: number;
  y: number;
}

export function ragDocumentWillScroll(target: EventTarget | null, delta: number) {
  if (!delta) return false;
  for (let element = target instanceof Element ? target : null; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      if (element.scrollHeight > element.clientHeight && (delta < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1)) return false;
      if (style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") return false;
    }
  }
  if ([document.body, document.documentElement].some(element => getComputedStyle(element).overflowY === "hidden")) return false;
  return delta < 0 ? window.scrollY > 0 : window.scrollY < document.documentElement.scrollHeight - window.innerHeight - 1;
}

function characterRange(block: Element, offset: number) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || "";
    if (offset >= text.length) { offset -= text.length; continue; }
    if (offset > 0 && /[\udc00-\udfff]/.test(text[offset])) offset--;
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + ((text.codePointAt(offset) || 0) > 0xffff ? 2 : 1));
    return range;
  }
  return null;
}

// A rendered character, not scrollY or a whole table's top, is the reading anchor.
export function captureRagReadingAnchor(root: HTMLElement): RagReadingAnchor | null {
  let top = 0;
  for (const header of document.querySelectorAll(".reader-toolbar, .mobile-topbar")) {
    const rect = header.getBoundingClientRect();
    if (rect.top <= 1 && rect.bottom > 0 && rect.height > 0) top = Math.max(top, rect.bottom);
  }
  for (const preview of root.querySelectorAll(".rag-answer .markdown-preview")) {
    const rect = preview.getBoundingClientRect(), start = Math.max(top, rect.top);
    const end = Math.min(window.innerHeight, rect.bottom, start + 120);
    const x = rect.left + Math.min(16, rect.width / 4);
    for (let y = start + 4; y < end; y += 16) {
      if (!preview.contains(document.elementFromPoint(x, y))) continue;
      const caret = document.caretRangeFromPoint?.(x, y);
      const position = !caret ? document.caretPositionFromPoint?.(x, y) : null;
      const node = caret?.startContainer || position?.offsetNode;
      const offset = caret?.startOffset ?? position?.offset;
      if (!node || node.nodeType !== Node.TEXT_NODE || offset === undefined || !preview.contains(node)) continue;
      const parent = node.parentElement!;
      const source = parent.closest("[data-source-block]") || preview;
      const detail = parent.closest("td, th, pre");
      const block = detail && source.contains(detail) ? detail : source;
      const prefix = document.createRange(); prefix.selectNodeContents(block); prefix.setEnd(node, offset);
      const textOffset = prefix.toString().length, range = characterRange(block, textOffset);
      const line = range?.getBoundingClientRect();
      if (!line || !line.height || line.top < top || line.bottom > window.innerHeight) continue;
      const path: number[] = [];
      for (let part = block; part !== source && part.parentElement; part = part.parentElement) {
        path.unshift(Array.prototype.indexOf.call(part.parentElement.children, part));
      }
      return { preview, block, source: source.getAttribute("data-source-start-offset"), tag: source.tagName.toLowerCase(), path, offset: textOffset, top: line.top, y: window.scrollY };
    }
  }
  return null;
}

export function restoreRagReadingAnchor(root: HTMLElement, anchor: RagReadingAnchor) {
  if (!root.contains(anchor.preview)) return false;
  let block: Element | null = anchor.block;
  if (!anchor.preview.contains(block)) {
    block = anchor.source === null ? anchor.preview : anchor.preview.querySelector(`${anchor.tag}[data-source-start-offset="${anchor.source}"]`);
    for (const index of anchor.path) block = block?.children[index] || null;
  }
  const range = block && characterRange(block, anchor.offset), rect = range?.getBoundingClientRect();
  if (!rect || !rect.height) return false;
  const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamped = anchor.y > maximum + 1 && Math.abs(window.scrollY - maximum) <= 1;
  // A viewport move that precedes its scroll event owns the new position.
  // Only native clamping after a shorter document is a layout correction.
  if (Math.abs(window.scrollY - anchor.y) > 0.5 && !clamped) return false;
  anchor.block = block!;
  const delta = rect.top - anchor.top;
  if (Math.abs(delta) > 0.5) {
    const before = window.scrollY;
    window.scrollBy({ top: delta, behavior: "instant" });
    // At a document boundary retain the closest position that is possible now.
    if (Math.abs(window.scrollY - before - delta) > 1) anchor.top = range!.getBoundingClientRect().top;
  }
  anchor.y = window.scrollY;
  return true;
}

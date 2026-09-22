"use client";

import { Check, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import type { HighlightingController } from "@/hooks/use-highlighting";
import "@/app/highlighting.css";

function changedLine(original: string, highlighted: string): ReactNode {
  if (original === highlighted) return highlighted || " ";
  const parts: ReactNode[] = []; let source = 0, target = 0, plain = "";
  const flush = () => { if (plain) { parts.push(plain); plain = ""; } };
  while (target < highlighted.length) {
    if (highlighted[target] === original[source]) { plain += highlighted[target++]; source++; }
    else if (highlighted.startsWith("**", target)) { flush(); parts.push(<span className="diff-bold-token" key={target}>**</span>); target += 2; }
    else plain += highlighted[target++];
  }
  flush(); return parts;
}

function ReviewContent({ highlighting }: { highlighting: HighlightingController }) {
  const [side, setSide] = useState(1);
  const originalRef = useRef<HTMLPreElement>(null), highlightedRef = useRef<HTMLPreElement>(null);
  const syncing = useRef(false);
  const closing = useRef(false);
  const { backdropRef, requestExit } = useDialogExit<HTMLDivElement>(close);
  const review = highlighting.review!;
  function close() {
    if (closing.current) return; closing.current = true;
    highlighting.cancel(); requestExit(highlighting.closeReview);
  }
  useEffect(() => lockBodyScroll(), []);
  useEffect(() => { originalRef.current?.scrollTo(0, 0); highlightedRef.current?.scrollTo(0, 0); }, [review]);
  function sync(source: HTMLPreElement, target: HTMLPreElement | null) {
    if (!target || !target.getClientRects().length || syncing.current) return;
    syncing.current = true;
    target.scrollTop = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight) * Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollLeft = source.scrollLeft / Math.max(1, source.scrollWidth - source.clientWidth) * Math.max(0, target.scrollWidth - target.clientWidth);
    requestAnimationFrame(() => { syncing.current = false; });
  }
  const originals = review.original.split(/\r?\n/), highlighted = review.highlighted.split(/\r?\n/), lines = Math.max(originals.length, highlighted.length);
  return <div ref={backdropRef} className="highlight-review-overlay" role="presentation" onMouseDown={close}>
    <div className="diff-dialog" role="dialog" aria-modal="true" aria-label="AI 重点标注差异查看" onMouseDown={event => event.stopPropagation()}>
      <div className="diff-header"><div><h3>重点标注浏览</h3><p>已标注 {review.boldCount} 处重点，模型：{review.model}</p></div><button className="button icon-only" type="button" onClick={close} aria-label="关闭差异查看"><X size={17} /></button></div>
      {(review.warnings.length > 0 || highlighting.status || highlighting.stale) && <div className="diff-warnings" role={highlighting.statusKind === "error" ? "alert" : "status"}>
        {review.warnings.map((warning, index) => <p className="status-line warning" key={`${index}:${warning}`}>{warning}</p>)}
        {highlighting.status && <p className={`status-line ${highlighting.statusKind}`}>{highlighting.status}</p>}
        {highlighting.stale && !highlighting.status && <p className="status-line warning">当前编辑草稿已变化，请重新标注后再应用。</p>}
      </div>}
      <div className="version-switch view-mode-switch" role="group" aria-label="查看版本">{["原文", "标注后"].map((label, index) => <button key={label} className={`view-mode-button${side === index ? " active" : ""}`} type="button" aria-pressed={side === index} onClick={() => setSide(index)}>{label}</button>)}</div>
      <div className="diff-grid" data-side={side}>
        <section className="diff-pane" aria-label="原始 Markdown"><div className="diff-pane-title">原文</div><pre ref={originalRef} onScroll={event => sync(event.currentTarget, highlightedRef.current)}>{Array.from({ length: lines }, (_, index) => <div className={`diff-line${originals[index] !== highlighted[index] ? " changed" : ""}`} key={index}><span className="diff-line-number">{index + 1}</span><code>{originals[index] || " "}</code></div>)}</pre></section>
        <section className="diff-pane" aria-label="标注后的 Markdown"><div className="diff-pane-title">标注后</div><pre ref={highlightedRef} onScroll={event => sync(event.currentTarget, originalRef.current)}>{Array.from({ length: lines }, (_, index) => <div className={`diff-line${originals[index] !== highlighted[index] ? " changed" : ""}`} key={index}><span className="diff-line-number">{index + 1}</span><code>{changedLine(originals[index] || "", highlighted[index] || "")}</code></div>)}</pre></section>
      </div>
      <div className="diff-actions"><button className="button secondary" type="button" disabled={highlighting.busy || !highlighting.configured || Boolean(highlighting.inputProblem)} onClick={() => void highlighting.request()}><RefreshCw size={15} />{highlighting.busy ? "标注中" : "重新标注"}</button><button className="button secondary" type="button" onClick={close}>关闭</button><button className="button primary" type="button" disabled={highlighting.busy || review.original === review.highlighted} onClick={() => void highlighting.apply()}><Check size={15} />应用到当前草稿</button></div>
    </div>
  </div>;
}

export function HighlightReviewDialog({ highlighting }: { highlighting: HighlightingController }) {
  return highlighting.active && highlighting.visible && highlighting.review ? createPortal(<ReviewContent highlighting={highlighting} />, document.body) : null;
}

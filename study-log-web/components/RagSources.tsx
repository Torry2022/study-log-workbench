"use client";

import { BookOpen, ChevronDown, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRagDisclosure } from "@/hooks/use-rag-disclosure";
import type { RagCitation } from "@/lib/rag-types";

export interface RagSourceRequest { messageId: string; sourceId: string; token: number }

/** Inline reference numbers reveal their source; entering the document is a separate action. */
export function RagSources({ messageId, citations, request, onOpen, onDisclosure }: {
  messageId: string; citations: RagCitation[]; request: RagSourceRequest | null; onOpen: (source: RagCitation) => void;
  onDisclosure: (followAtBottom: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const sourceId = request?.sourceId;
  const targetIndex = citations.findIndex(source => source.sourceId === sourceId);
  const reveal = Boolean(request && targetIndex >= 3);
  const [handled, setHandled] = useState(0);
  const expanded = all || Boolean(reveal && request && request.token !== handled);
  const disclosure = useRagDisclosure<HTMLDivElement>(expanded);

  useEffect(() => {
    if (!request || targetIndex < 0 || !root.current) return;
    if (targetIndex >= 3) setAll(true);
    setHandled(request.token);
    setHighlight(null);
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, cancelled = false;
    let scroller: Element | null = null;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true; cancelAnimationFrame(frame);
      const current = scroller || document.scrollingElement;
      current?.scrollTo({ top: current.scrollTop, behavior: "instant" });
    };
    const mark = () => {
      if (cancelled) return;
      setHighlight(request.sourceId);
      timer = setTimeout(() => setHighlight(null), 1800);
    };
    const deltaFor = (target: HTMLElement) => {
      let top = window.visualViewport?.offsetTop || 0;
      let bottom = top + (window.visualViewport?.height || window.innerHeight);
      for (const header of document.querySelectorAll(".topbar, .reader-toolbar, .mobile-topbar")) {
        const rect = header.getBoundingClientRect();
        if (rect.top <= top + 1 && rect.bottom > top) top = rect.bottom;
      }
      const dock = root.current?.closest(".rag-workspace")?.querySelector(".rag-composer-slot:not(.is-hidden)")?.getBoundingClientRect();
      if (dock && dock.top < bottom && dock.bottom > top) bottom = Math.min(bottom, dock.top - 8);
      const navigation = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
      if (navigation && navigation.height > 0 && navigation.top < bottom && navigation.bottom > top) bottom = Math.min(bottom, navigation.top - 8);
      if (scroller) { const rect = scroller.getBoundingClientRect(); top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
      const rect = target.getBoundingClientRect();
      const toggle = target === target.parentElement?.lastElementChild ? root.current?.querySelector<HTMLElement>(".rag-list-toggle")?.getBoundingClientRect() : null;
      const targetBottom = toggle && toggle.bottom - rect.top <= bottom - top - 16 ? Math.max(rect.bottom, toggle.bottom) : rect.bottom;
      const floating = document.querySelector<HTMLElement>(".back-to-top-control.is-visible")?.getBoundingClientRect();
      if (floating && floating.left < rect.right && floating.right > rect.left && floating.top < targetBottom && floating.bottom > rect.top) {
        if (floating.top + floating.height / 2 < (top + bottom) / 2) top = Math.max(top, floating.bottom + 8);
        else bottom = Math.min(bottom, floating.top - 8);
      }
      return rect.top < top + 8 || targetBottom - rect.top > bottom - top - 16 ? rect.top - top - 8 : targetBottom > bottom - 8 ? targetBottom - bottom + 8 : 0;
    };
    const locate = (target: HTMLElement) => {
      const delta = deltaFor(target);
      if (Math.abs(delta) < 1) { mark(); return; }
      const scroll = scroller || document.scrollingElement!;
      scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      const start = performance.now(); let previous = -1, stable = 0;
      const settle = () => {
        if (cancelled) return;
        if (!target.isConnected) { cancel(); return; }
        stable = Math.abs(scroll.scrollTop - previous) < 0.5 ? stable + 1 : 0; previous = scroll.scrollTop;
        if (stable >= 3 && performance.now() - start > 80 || performance.now() - start > 1000) {
          // Dock/disclosure layout can change during the native smooth scroll.
          scroll.scrollTo({ top: scroll.scrollTop, behavior: "instant" });
          const remaining = deltaFor(target);
          if (Math.abs(remaining) >= 1) scroll.scrollTo({ top: scroll.scrollTop + remaining, behavior: "instant" });
          mark();
        }
        else frame = requestAnimationFrame(settle);
      };
      frame = requestAnimationFrame(settle);
    };
    let previousLayout = "", layoutStable = 0;
    const ready = () => {
      if (cancelled) return;
      const target = root.current?.querySelector<HTMLElement>(`[data-rag-source="${request.sourceId}"]`);
      if (!target) return;
      let animating = false;
      for (let element = target.parentElement; element && element !== document.body; element = element.parentElement) {
        if (!scroller && /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight) scroller = element;
        if (element.getAnimations().some(animation => animation.playState === "running")) animating = true;
      }
      const rect = target.getBoundingClientRect(), scroll = scroller || document.scrollingElement!;
      const layout = `${Math.round((rect.top + scroll.scrollTop) * 2)}:${Math.round(rect.height * 2)}`;
      layoutStable = !animating && layout === previousLayout ? layoutStable + 1 : 0;
      previousLayout = layout;
      if (layoutStable >= 3) locate(target);
      else frame = requestAnimationFrame(ready);
    };
    frame = requestAnimationFrame(ready);
    const key = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel(); };
    window.addEventListener("wheel", cancel, { passive: true }); window.addEventListener("touchstart", cancel, { passive: true }); window.addEventListener("keydown", key);
    return () => { cancel(); clearTimeout(timer); window.removeEventListener("wheel", cancel); window.removeEventListener("touchstart", cancel); window.removeEventListener("keydown", key); };
    // Changes to the rendered citation collection must not restart an already handled request.
  }, [request?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!citations.length) return null;
  const shown = expanded ? citations : citations.slice(0, 3);
  return <div className="rag-citations" ref={root} aria-label="回答来源">
    <div className="rag-citations-title"><BookOpen size={14} />来源<span>{citations.length}</span></div>
    <div className="rag-citation-list" ref={disclosure.ref} id={`rag-sources-${messageId}`}>
      {shown.map(source => <div key={source.sourceId} data-rag-source={source.sourceId} id={`rag-source-${messageId}:${source.sourceId}`}
        className={`rag-citation-entry${detail === source.sourceId ? " expanded" : ""}${highlight === source.sourceId ? " is-located" : ""}`}>
        <button className="rag-citation" type="button" aria-expanded={detail === source.sourceId}
          onClick={() => { onDisclosure(false); setDetail(current => current === source.sourceId ? null : source.sourceId); }}>
          <span>{source.sourceId}</span><strong>{source.date}</strong>
          <em>{source.heading || "日志原文"}</em><ChevronDown size={14} />
        </button>
        {detail === source.sourceId && <div className="rag-citation-detail"><p>{source.excerpt || "该历史会话未保存来源片段，可前往来源页面查看。"}</p>
          <button type="button" onClick={() => onOpen(source)}><FileText size={14} />
            查看原日志</button></div>}
      </div>)}
    </div>
    {citations.length > 3 && <button className="rag-list-toggle" type="button" aria-expanded={expanded} aria-controls={`rag-sources-${messageId}`}
      onClick={() => { onDisclosure(true); disclosure.prepare(); if (expanded) { setHandled(request?.token || 0); setAll(false); } else setAll(true); }}>
      {expanded ? "收起来源" : `展开剩余 ${citations.length - 3} 条来源`}<ChevronDown size={14} aria-hidden="true" />
    </button>}
  </div>;
}

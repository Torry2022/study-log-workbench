"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ragNavigationEntries, type RagHistoryWindow } from "@/lib/rag-history";
import type { RagChatMessage } from "@/lib/rag-types";
import "./RagHistoryNavigation.css";

export interface RagHistoryPosition { id: string; top: number; y: number }
export interface RagHistoryControl {
  window?: RagHistoryWindow; loading: boolean; error: string;
  loadEarlier: (questionId?: string) => Promise<boolean>;
  readingPosition?: RagHistoryPosition;
  rememberPosition: (position: RagHistoryPosition | undefined) => void;
}
function topInset() {
  return Math.max(0, ...Array.from(document.querySelectorAll(".reader-toolbar, .mobile-topbar, .reader-header"))
    .map(item => item.getBoundingClientRect()).filter(rect => rect.top <= 80 && rect.bottom > 0).map(rect => rect.bottom));
}
function readingPosition(root: HTMLElement): RagHistoryPosition | undefined {
  const article = Array.from(root.querySelectorAll<HTMLElement>("[data-rag-message-id]"))
    .find(item => item.getBoundingClientRect().bottom > topInset() + 8);
  return article ? { id: article.dataset.ragMessageId!, top: article.getBoundingClientRect().top, y: scrollY } : undefined;
}
function messageElement(root: HTMLElement, id: string) {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-rag-message-id]")).find(item => item.dataset.ragMessageId === id);
}
export function RagHistoryNavigation({ history, root, messages, navigationToken, initializing, enabled = true, onNavigate, onInitialEnd }: {
  history?: RagHistoryControl; root: RefObject<HTMLDivElement | null>; messages: RagChatMessage[];
  navigationToken: number; initializing: boolean; enabled?: boolean; onNavigate: () => void; onInitialEnd: () => void;
}) {
  const current = useRef(history); current.current = history;
  const snapshot = useRef<RagHistoryPosition | undefined>(undefined);
  const opened = useRef<number | null>(null);
  const pending = useRef(false);
  const readingIntent = useRef(false);
  const queuedTarget = useRef<string | undefined>(undefined);
  const navigation = useRef(navigationToken); navigation.current = navigationToken;
  const raf = useRef(0);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState("");
  const [hovered, setHovered] = useState("");
  const [railLeft, setRailLeft] = useState<number | null>(null);
  const [railTop, setRailTop] = useState(0);
  const entries = ragNavigationEntries(history?.window?.outline || [], messages);
  const peek = entries.find(entry => entry.questionId === hovered);

  useLayoutEffect(() => {
    const node = peekRef.current; if (!node) return;
    const half = node.offsetHeight / 2, center = railTop + entries.findIndex(entry => entry.questionId === hovered) * 12 + 14;
    node.style.top = `${Math.max(half + 8, Math.min(innerHeight - half - 8, center)) - railTop}px`;
  }, [hovered, railTop, peek?.question, peek?.preview]);

  const jump = (id: string) => {
    const node = root.current && messageElement(root.current, id);
    if (!node) return;
    const separator = node.previousElementSibling;
    const time = separator?.matches('.rag-time-divider, .rag-time-separator') ? separator.querySelector('time') : null;
    const target = time || node.querySelector(':scope > p, :scope > .rag-question-editor') || node;
    onNavigate();
    window.scrollTo({ top: scrollY + target.getBoundingClientRect().top - topInset() - 16,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    setActive(id);
  };
  const load = async (id?: string) => {
    if (pending.current) { if (id) queuedTarget.current = id; return; }
    if (!root.current || current.current?.loading) return;
    if (id && messageElement(root.current, id)) { jump(id); return; }
    const anchor = readingPosition(root.current), token = navigationToken;
    pending.current = true; readingIntent.current = false; onNavigate();
    try {
      if (!await current.current?.loadEarlier(id)) return;
      // React commits before the next frame; markdown layout can settle in the following frame.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (navigation.current !== token) return;
      if (id) jump(id);
      else if (anchor && root.current) {
        const node = messageElement(root.current, anchor.id);
        if (node) window.scrollBy({ top: node.getBoundingClientRect().top - anchor.top, behavior: "instant" });
      }
    } finally {
      pending.current = false;
      const next = queuedTarget.current; queuedTarget.current = undefined;
      if (next && navigation.current === token) void loadRef.current(next);
    }
  };
  const loadRef = useRef(load); loadRef.current = load;

  useLayoutEffect(() => {
    if (!enabled) { opened.current = null; return; }
    if (!enabled || !root.current?.getClientRects().length || initializing || !messages.length || opened.current === navigationToken) return;
    opened.current = navigationToken;
    const position = history?.readingPosition;
    if (position && root.current) {
      const node = messageElement(root.current, position.id);
      window.scrollTo({ top: node ? scrollY + node.getBoundingClientRect().top - position.top : position.y, behavior: "instant" });
    } else onInitialEnd();
  }, [enabled, initializing, messages.length, navigationToken]); // Navigation owns this one-time placement.

  useLayoutEffect(() => {
    const owner = history;
    return () => { owner?.rememberPosition(snapshot.current); };
  }, [navigationToken, enabled]);

  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        if (!root.current?.getClientRects().length) return;
        snapshot.current = readingPosition(root.current);
        const questions = Array.from(root.current.querySelectorAll<HTMLElement>('.rag-message-user[data-rag-message-id]'));
        const question = [...questions].reverse().find(node => node.getBoundingClientRect().top <= topInset() + innerHeight * .35) || questions[0];
        if (question) setActive(question.dataset.ragMessageId!);
        const rect = root.current.getBoundingClientRect(), content = root.current.querySelector('.rag-message-list')?.getBoundingClientRect();
        setRailLeft(content && content.left - rect.left >= 32 ? rect.left + 8 : null);
        setRailTop(Math.max(topInset() + 24, innerHeight / 2 - Math.min(entries.length * 6, 180)));
        const first = root.current.querySelector('[data-rag-message-id]')?.getBoundingClientRect();
        if (readingIntent.current && current.current?.window?.start && !current.current.error && first && scrollY + innerHeight < document.documentElement.scrollHeight - 32 && first.top >= topInset() - innerHeight * .75) void loadRef.current();
      });
    };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0 && root.current?.contains(event.target as Node)) readingIntent.current = true; update(); };
    const touch = (event: TouchEvent) => { if (root.current?.contains(event.target as Node)) { readingIntent.current = true; update(); } };
    const key = (event: KeyboardEvent) => { if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable=true]')) return; if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { readingIntent.current = true; update(); } };
    update(); addEventListener('scroll', update, { passive: true }); addEventListener('resize', update);
    addEventListener('wheel', wheel, { passive: true }); addEventListener('touchmove', touch, { passive: true }); addEventListener('keydown', key);
    return () => { cancelAnimationFrame(raf.current); removeEventListener('scroll', update); removeEventListener('resize', update); removeEventListener('wheel', wheel); removeEventListener('touchmove', touch); removeEventListener('keydown', key); };
  }, [navigationToken, messages.length, entries.length]);

  return <>
    {history?.window && history.window.start > 0 && <div className="qa-history-load" role="status">
      {history.error && <span>{history.error}</span>}
      <button type="button" disabled={history.loading} onClick={() => void load()}>{history.loading ? "正在加载更早消息…" : history.error ? "重试" : "加载更早消息"}</button>
    </div>}
    {enabled && entries.length > 1 && railLeft !== null && createPortal(<nav className="qa-history-rail" aria-label="本次对话快速跳转"
      style={{ left: railLeft, top: railTop }} onMouseLeave={() => setHovered("")}>
      {entries.map(entry => <button key={entry.questionId} type="button" tabIndex={-1} className={`qa-history-tick${active === entry.questionId ? " is-current" : ""}`}
        aria-label={entry.question} aria-current={active === entry.questionId ? "location" : undefined}
        onMouseEnter={() => setHovered(entry.questionId)} onClick={() => void load(entry.questionId)}><span /></button>)}
      {peek && <div ref={peekRef} className="qa-history-peek" role="tooltip" style={{ top: entries.findIndex(entry => entry.questionId === hovered) * 12 + 14 }}><strong>{peek.question}</strong><p>{peek.preview}</p></div>}
    </nav>, document.body)}
  </>;
}

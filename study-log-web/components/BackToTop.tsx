"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import type { WorkspaceView } from "@/hooks/use-log-workspace";
import "@/app/back-to-top.css";
import { isEditingTarget, workspaceShortcutBlocked } from "@/lib/workspace-shortcuts";

export function BackToTop({ view, active }: { view: WorkspaceView; active: boolean }) {
  const control = useRef<HTMLDivElement>(null);
  const keepVisible = useRef(false);
  const [state, setState] = useState({ visible: false, progress: 0, right: 24 });
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>, frame = 0;
    const reader = document.querySelector<HTMLElement>(`.view-${view} .reader`);
    const surfaces = () => [document.scrollingElement, ...Array.from(reader?.querySelectorAll<HTMLElement>(".reader-preview-pane, .cm-scroller, .stats-shell-embedded") ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0 && !element.closest('[hidden]'));
    const update = (show = false) => {
      const items = surfaces();
      const top = Math.max(0, ...items.map(element => element.scrollTop));
      const progress = Math.max(0, ...items.map(element => element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0));
      // Keep a focused control mounted through the last pixels of smooth scrolling.
      setState(previous => ({ visible: top > 0 && ((show && top > 8) || previous.visible), progress: Math.min(1, progress), right: Math.max(24, innerWidth - (reader?.getBoundingClientRect().right ?? innerWidth) + 24) }));
    };
    const scheduleHide = () => { clearTimeout(timer); timer = setTimeout(() => { if (!keepVisible.current) setState(previous => ({ ...previous, visible: false })); }, 2500); };
    const scroll = (event: Event) => {
      if (event.target !== document && !surfaces().includes(event.target as HTMLElement)) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => update(true)); scheduleHide();
    };
    const resize = new ResizeObserver(() => update()); if (reader) resize.observe(reader);
    document.addEventListener("scroll", scroll, true);
    const leave = () => { keepVisible.current = false; scheduleHide(); };
    const enter = () => { keepVisible.current = true; clearTimeout(timer); };
    const node = control.current;
    node?.addEventListener("pointerenter", enter); node?.addEventListener("pointerleave", leave);
    node?.addEventListener("focusin", enter); node?.addEventListener("focusout", leave);
    setState(previous => ({ ...previous, visible: false })); update();
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); resize.disconnect(); document.removeEventListener("scroll", scroll, true); node?.removeEventListener("pointerenter", enter); node?.removeEventListener("pointerleave", leave); node?.removeEventListener("focusin", enter); node?.removeEventListener("focusout", leave); };
  }, [view, active]);
  const top = () => {
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    document.querySelectorAll<HTMLElement>(`.view-${view} .reader .reader-preview-pane, .view-${view} .reader .cm-scroller, .view-${view} .reader .stats-shell-embedded`).forEach(element => {
      if (element.scrollTop > 0 && element.getClientRects().length && !element.closest('[hidden]')) element.scrollTo({ top: 0, behavior });
    });
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior });
  };
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (workspaceShortcutBlocked(event) || isEditingTarget(event.target) || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== "ArrowUp") return;
      event.preventDefault(); top();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, view]);
  return <div ref={control} className={`back-to-top-control${active && state.visible ? " is-visible" : ""}`} style={{ right: state.right }} aria-hidden={!active || !state.visible}>
    <svg className="back-to-top-progress" viewBox="0 0 48 48" aria-hidden="true">
      <rect className="back-to-top-progress-track" x="1.5" y="1.5" width="45" height="45" rx="11" pathLength="100" />
      <rect className="back-to-top-progress-value" x="1.5" y="1.5" width="45" height="45" rx="11" pathLength="100" style={{ strokeDashoffset: 100 - state.progress * 100 }} />
    </svg>
    <button className="back-to-top-button" type="button" disabled={!active || !state.visible} onClick={top} aria-label={`返回顶部，当前滚动进度 ${Math.round(state.progress * 100)}%`} title="返回顶部"><ArrowUp size={18} /></button>
  </div>;
}

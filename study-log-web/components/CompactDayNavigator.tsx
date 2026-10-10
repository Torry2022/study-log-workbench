"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

export function CompactDayNavigator({ sidebar, marker, selectedDate, previousDate, nextDate, busy, query, onQuery, onDate, selectionRevision, children }: {
  sidebar: RefObject<HTMLElement | null>; marker: RefObject<HTMLSpanElement | null>;
  selectedDate: string; previousDate: string | null; nextDate: string | null; busy: boolean;
  query: string; onQuery: (value: string) => void; onDate: (date: string) => Promise<boolean>;
  selectionRevision: number;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<{ left: number; width: number } | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setOpen(false); }, [selectionRevision]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = sidebar.current?.getBoundingClientRect();
        const visible = marker.current && marker.current.getBoundingClientRect().top <= 0;
        setPosition(visible && rect ? { left: rect.left + 12, width: rect.width - 24 } : null);
        if (!visible) setOpen(false);
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (sidebar.current) observer.observe(sidebar.current);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [sidebar, marker, children]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector('[role="alertdialog"]')) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, [open]);
  async function navigate(date: string) { if (await onDate(date)) setOpen(false); }
  if (!position) return null;
  return <div className="compact-day-navigator visible" ref={root} style={position} aria-label="紧凑日期导航">
    <div className="compact-day-navigator-bar">
      <button type="button" disabled={!previousDate || busy} aria-label="上一篇" title="上一篇" onClick={() => previousDate && void navigate(previousDate)}><ChevronLeft size={16} /></button>
      <button ref={trigger} className="compact-day-current" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="compact-day-menu" aria-label="选择日期"><CalendarDays size={14} /><span>{selectedDate || "选择日期"}</span><ChevronDown size={13} className="compact-day-chevron" /></button>
      <button type="button" disabled={!nextDate || busy} aria-label="下一篇" title="下一篇" onClick={() => nextDate && void navigate(nextDate)}><ChevronRight size={16} /></button>
    </div>
    {open && <div className="compact-day-menu" id="compact-day-menu">
      <div className="sidebar-search"><Search size={14} /><input ref={input} value={query} onChange={event => onQuery(event.target.value)} placeholder="按标签定位日期" aria-label="在紧凑导航中按标签搜索日期" />{query && <button className="sidebar-search-clear" type="button" onClick={() => { onQuery(""); input.current?.focus(); }} aria-label="清空紧凑导航搜索"><X size={13} /></button>}</div>
      <div className="day-list compact-day-list">{children}</div>
    </div>}
  </div>;
}

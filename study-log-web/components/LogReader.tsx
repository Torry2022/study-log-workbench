"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpen, List, Maximize2, X } from "lucide-react";
import { MarkdownPreview } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { toEditableDayBody } from "@/lib/day-content";
import { containModalFocus } from "@/hooks/use-dialog-exit";
import type { DayEntry } from "@/lib/types";
import "@/app/reader.css";

interface Props {
  active: boolean;
  navigationRevision: number;
  day: DayEntry | null; date: string; heading: string; scrollTarget: number | null;
  loading: boolean; error: string; theme: "light" | "dark"; reading: boolean;
  onReading: (value: boolean) => void; onRetry: () => void;
  onNavigate: (date: string, heading?: string) => void;
}

export function LogReader({ active, navigationRevision, day, date, heading, scrollTarget, loading, error, theme, reading, onReading, onRetry, onNavigate }: Props) {
  const content = useMemo(() => day ? toEditableDayBody(day.date, day.content) : "", [day]);
  const headings = useMemo(() => buildMarkdownOutline(content), [content]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState("");
  const outline = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const ready = Boolean(day?.exists && !loading && !error);

  useEffect(() => { setOutlineOpen(false); }, [date, reading]);
  useEffect(() => { if (!active) setOutlineOpen(false); }, [active]);
  useEffect(() => {
    if (!outlineOpen || !outline.current) return;
    const release = containModalFocus(outline.current, () => setOutlineOpen(false));
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { release(); document.body.style.overflow = previous; };
  }, [outlineOpen]);
  useEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const update = () => {
      const reader = element.closest<HTMLElement>(".reader");
      reader?.style.setProperty("--reader-toolbar-height", `${element.offsetHeight}px`);
      reader?.style.setProperty("--reader-toolbar-bottom", `${element.getBoundingClientRect().bottom}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [reading]);
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      if (scrollTarget !== null) { window.scrollTo({ top: scrollTarget, behavior: "instant" }); return; }
      const target = headings.find(item => item.id === heading || item.text === heading);
      if (target) document.getElementById(target.id)?.scrollIntoView({ block: "start", behavior: "instant" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, date, heading, headings, scrollTarget, navigationRevision]);
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = (toolbar.current?.getBoundingClientRect().bottom || 0) + 24;
        let active = headings[0]?.id || "";
        for (const item of headings) if ((document.getElementById(item.id)?.getBoundingClientRect().top ?? Infinity) <= top) active = item.id;
        setActiveHeading(active);
      });
    };
    update(); window.addEventListener("scroll", update, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", update); };
  }, [ready, headings]);

  const outlineButton = <button className="mobile-toolbar-icon" type="button" aria-label="打开日志大纲" disabled={!headings.length || !ready} onClick={() => setOutlineOpen(true)}><List size={18} /></button>;
  const renderOutline = (popup: boolean) => <nav className="preview-outline" aria-label="当前日志大纲" ref={popup ? outline : undefined} role={popup ? "dialog" : undefined} aria-modal={popup ? true : undefined}>
    {popup && <button className="mobile-outline-close" type="button" aria-label="关闭大纲" onClick={() => setOutlineOpen(false)}><X size={18} /></button>}
    <div className="preview-outline-inner"><div className="preview-outline-title">目录</div><div className="preview-outline-list">
      {headings.map(item => <div className={`outline-row${item.id === activeHeading ? " active" : ""}`} key={item.id} style={{ "--outline-indent": `${Math.max(0, item.level - (headings[0]?.level || 3)) * 12}px` } as CSSProperties}>
        <button className="outline-item" type="button" title={item.text} aria-current={item.id === activeHeading ? "location" : undefined} onClick={() => { setOutlineOpen(false); onNavigate(date, item.id); }}>{item.text}</button>
      </div>)}
    </div></div>
  </nav>;

  return <>
    <div className="reader-toolbar-container" ref={toolbar}><div className={`reader-toolbar reader-toolbar-log${reading ? " reading-active" : ""}`}>
      <div className="reading-mode-toolbar"><div className="reading-mode-identity"><BookOpen size={18} /><h2>{date}</h2></div><div className="reading-mode-actions">{outlineButton}<button className="button secondary" type="button" onClick={() => onReading(false)}>退出阅读</button></div></div>
      <div className="reader-log-identity"><span className="eyebrow">{day?.fileName || "Markdown"}</span><div className="reader-heading-row"><h2>{date || "未选择日期"}</h2></div></div>
      <div className="reader-controls reader-outline-access">{outlineButton}</div>
      <div className="mobile-log-toolbar"><div className="mobile-log-identity"><strong>{date || "未选择日期"}</strong></div><div className="mobile-log-actions">{outlineButton}<button className="mobile-toolbar-icon" type="button" aria-label="进入阅读模式" disabled={!ready} onClick={() => onReading(true)}><Maximize2 size={17} /></button></div></div>
    </div></div>
    {loading ? <div className="preview-loading" role="status">正在读取日志…</div> : error ? <div className="preview-empty" role="alert"><p>{error}</p><button className="button secondary" onClick={onRetry}>重试</button></div> : !day?.exists ? <div className="preview-empty"><p>{date ? "这一天暂无学习日志" : "暂无学习日志，请从左侧选择日期"}</p></div> : <div className={`preview-workspace${headings.length ? " has-outline" : ""}`}>
      <div className="preview-pane"><MarkdownPreview active={active} content={content} headings={headings} themeMode={theme} onInternalLink={target => onNavigate(target.date || date, target.headingText)} />
        {!reading && <button className="button preview-reading-mode-entry" type="button" aria-label="进入阅读模式" onClick={() => onReading(true)}><Maximize2 size={18} /></button>}
      </div>{headings.length > 0 && renderOutline(false)}
    </div>}
    {outlineOpen && <div className="reader-outline-modal mobile-panel-outline" onClick={() => setOutlineOpen(false)}><div onClick={event => event.stopPropagation()}>{renderOutline(true)}</div></div>}
  </>;
}

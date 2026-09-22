"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpen, Edit3, Eye, FileText, List, Maximize2, MoreHorizontal, RefreshCw, Save, X } from "lucide-react";
import { MarkdownPreview, type InternalLinkTarget } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { toEditableDayBody } from "@/lib/day-content";
import { containModalFocus } from "@/hooks/use-dialog-exit";
import type { DayEntry } from "@/lib/types";
import { LogEditor } from "./LogEditor";
import type { EditorView } from "@codemirror/view";
import { useReadingPosition } from "@/hooks/use-reading-position";
import "@/app/reader.css";

export type WorkspaceMode = "preview" | "source" | "split";
interface Editing {
  mode: WorkspaceMode; onMode: (value: WorkspaceMode) => void;
  documentDate: string; body: string; dirty: boolean; busy: boolean; saved: boolean; error: string; conflict: boolean;
  onChange: (value: string) => void; onSave: () => void; onReload: () => void; onDiscard: () => void;
}
interface Props {
  editing: Editing;
  active: boolean;
  navigationRevision: number;
  day: DayEntry | null; date: string; heading: string; scrollTarget: number | null;
  loading: boolean; error: string; theme: "light" | "dark"; reading: boolean;
  onReading: (value: boolean) => void; onRetry: () => void;
  onNavigate: (date: string, heading?: string) => void;
}

export function LogReader({ editing, active, navigationRevision, day, date, heading, scrollTarget, loading, error, theme, reading, onReading, onRetry, onNavigate }: Props) {
  const content = useMemo(() => editing.documentDate === date ? editing.body : day ? toEditableDayBody(day.date, day.content) : "", [editing.documentDate, editing.body, date, day]);
  const headings = useMemo(() => buildMarkdownOutline(content), [content]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actions = useRef<HTMLElement>(null);
  const [activeHeading, setActiveHeading] = useState("");
  const outline = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const preview = useRef<HTMLElement>(null);
  const restorePending = useRef(false);
  const position = useReadingPosition({ editor: () => editorView.current, preview: () => preview.current,
    toolbarBottom: () => toolbar.current?.getBoundingClientRect().bottom || 0 });
  const ready = Boolean(day?.exists && !loading && !error);
  const editorReady = Boolean(date && editing.documentDate === date);
  const mode = reading ? "preview" : editing.mode;
  const openInternalLink = useCallback((target: InternalLinkTarget) => { onNavigate(target.date || date, target.headingText); }, [date, onNavigate]);
  function changeMode(next: WorkspaceMode) {
    if (next === mode) return;
    position.capture(mode); restorePending.current = true; editing.onMode(next);
  }
  function changeReading(value: boolean) { position.capture(mode); restorePending.current = true; onReading(value); }
  useEffect(() => {
    if (!restorePending.current) return;
    let frame = 0, attempts = 0;
    const restore = () => {
      editorView.current?.requestMeasure();
      frame = requestAnimationFrame(() => {
        if (position.restore(mode) || ++attempts >= 6) restorePending.current = false;
        else restore();
      });
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [mode, reading, editorReady, position.restore]);

  useEffect(() => { setOutlineOpen(false); setActionsOpen(false); }, [date, reading]);
  useEffect(() => { if (!active) { setOutlineOpen(false); setActionsOpen(false); } }, [active]);
  useEffect(() => {
    if (!actionsOpen || !actions.current) return;
    const release = containModalFocus(actions.current, () => setActionsOpen(false));
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { release(); document.body.style.overflow = previous; };
  }, [actionsOpen]);
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
  }, [ready, date, heading, scrollTarget, navigationRevision]);
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
  const modes = [["preview", "浏览", Eye], ["source", "源码", Edit3], ["split", "分屏", FileText]] as const;
  const modeButtons = (mobile = false) => <div className={mobile ? "mobile-mode-switch" : "view-mode-switch"} role="group" aria-label="工作区模式">{modes.filter(([value]) => !mobile || value !== "split").map(([value, label, Icon]) => <button key={value} type="button" className={`view-mode-button${(mode === value || (mobile && mode === "split" && value === "source")) ? " active" : ""}`} aria-pressed={mode === value || (mobile && mode === "split" && value === "source")} onClick={() => changeMode(value)}><Icon size={15} />{label}</button>)}</div>;
  const saveButton = (mobile = false) => <button className={mobile ? "mobile-toolbar-icon primary" : "button primary toolbar-save-button"} type="button" aria-label={editing.busy ? "保存中" : "保存"} disabled={!editorReady || !active || editing.busy || (!editing.dirty && Boolean(day?.exists))} onClick={editing.onSave}><Save size={15} />{!mobile && (editing.busy ? "保存中" : "保存")}</button>;
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
      <div className="reading-mode-toolbar"><div className="reading-mode-identity"><BookOpen size={18} /><h2>{date}</h2></div><div className="reading-mode-actions">{outlineButton}<button className="button secondary" type="button" onClick={() => changeReading(false)}>退出阅读</button></div></div>
      <div className="reader-log-identity"><span className="eyebrow">{day?.fileName || "Markdown"}</span><div className="reader-heading-row"><h2>{date || "未选择日期"}</h2></div></div>
      <div className="reader-controls reader-log-controls"><div className="reader-mode-actions">{modeButtons()}<select className="log-mode-select" value={mode} aria-label="工作区模式" onChange={event => changeMode(event.target.value as WorkspaceMode)}>{modes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="reader-outline-access">{outlineButton}</div>{saveButton()}</div>
      <div className="mobile-log-toolbar"><div className="mobile-log-identity"><strong>{date || "未选择日期"}</strong></div><div className="mobile-log-actions">{modeButtons(true)}{saveButton(true)}<button className="mobile-toolbar-icon" type="button" aria-label="更多日志操作" onClick={() => setActionsOpen(true)}><MoreHorizontal size={19} /></button></div></div>
    </div></div>
    <div className={`reader-content editing-workspace mode-${mode}`}>
    {(editing.error || editing.dirty || editing.saved) && <div className="editor-save-status" role={editing.error ? "alert" : "status"}>{editing.error || (editing.dirty ? "有未保存修改" : "已保存")}{editing.dirty && <button className="button secondary" type="button" disabled={editing.busy} onClick={editing.onDiscard}>放弃修改</button>}{editing.conflict && <button className="button secondary" type="button" onClick={editing.onReload}>重新读取</button>}</div>}
    <div className="reader-preview-pane" style={{ display: mode === "source" ? "none" : undefined }}>
    {loading ? <div className="preview-loading" role="status">正在读取日志…</div> : error ? <div className="preview-empty" role="alert"><p>{error}</p><button className="button secondary" onClick={onRetry}>重试</button></div> : !day?.exists && !content.trim() ? <div className="preview-empty"><p>{date ? "这一天暂无学习日志" : "暂无学习日志，请从左侧选择日期"}</p></div> : <div className={`preview-workspace${headings.length && mode === "preview" ? " has-outline" : ""}`}>
      <div className="preview-pane"><MarkdownPreview active={active} containerRef={preview} content={content} headings={headings} themeMode={theme} onInternalLink={openInternalLink} />
        {!reading && <button className="button preview-reading-mode-entry" type="button" aria-label="进入阅读模式" onClick={() => changeReading(true)}><Maximize2 size={18} /></button>}
      </div>{headings.length > 0 && mode === "preview" && renderOutline(false)}
    </div>}
    </div>
    <div className="source-workspace" style={{ display: mode === "preview" ? "none" : undefined }} inert={!active || mode === "preview"}>
      {editorReady ? <LogEditor date={date} value={editing.body} active={active && mode !== "preview"} onChange={editing.onChange} onSave={editing.onSave} onView={view => { editorView.current = view; }} /> : <div className="source-empty">{loading ? "正在读取日志…" : "选择日期以编辑学习日志"}</div>}
    </div></div>
    {outlineOpen && <div className="reader-outline-modal mobile-panel-outline" onClick={() => setOutlineOpen(false)}><div onClick={event => event.stopPropagation()}>{renderOutline(true)}</div></div>}
    {actionsOpen && <div className="mobile-sheet-backdrop" onClick={() => setActionsOpen(false)}><section className="mobile-action-sheet" ref={actions} role="dialog" aria-modal="true" aria-label="日志操作" onClick={event => event.stopPropagation()}>
      <div className="mobile-sheet-header"><div><strong>日志操作</strong><span>{date}</span></div><button type="button" aria-label="关闭日志操作" onClick={() => setActionsOpen(false)}><X size={18} /></button></div>
      <div className="mobile-sheet-grid">
        <button type="button" disabled={!date || editing.busy} onClick={() => { setActionsOpen(false); editing.onReload(); }}><RefreshCw size={18} />刷新</button>
        <button type="button" disabled={!headings.length} onClick={() => { setActionsOpen(false); editing.onMode("preview"); setOutlineOpen(true); }} aria-label="打开日志大纲"><List size={18} />大纲</button>
        <button type="button" disabled={!ready} onClick={() => { setActionsOpen(false); changeReading(true); }} aria-label="进入阅读模式"><Maximize2 size={18} />阅读模式</button>
        <button type="button" disabled={!editing.dirty || editing.busy} onClick={() => { setActionsOpen(false); editing.onDiscard(); }}><Eye size={18} />放弃修改</button>
      </div>
    </section></div>}
  </>;
}

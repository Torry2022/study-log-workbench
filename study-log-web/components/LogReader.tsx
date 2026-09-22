"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BookOpen, CornerUpLeft, DatabaseBackup, Edit3, Eye, FileText, Link2, List, Maximize2, MoreHorizontal, RefreshCw, Save, Star, Trash2, Upload, X } from "lucide-react";
import { MarkdownPreview, type InternalLinkTarget } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { toEditableDayBody } from "@/lib/day-content";
import { containModalFocus, lockBodyScroll } from "@/hooks/use-dialog-exit";
import type { DayEntry } from "@/lib/types";
import { LogEditor } from "./LogEditor";
import type { EditorView } from "@codemirror/view";
import { useReadingPosition } from "@/hooks/use-reading-position";
import { useEditorAttachments } from "@/hooks/use-editor-attachments";
import { IMAGE_ACCEPT } from "@/lib/asset-upload-rules";
import { insertAtRange, type InsertionRange } from "@/lib/editor-insertion";
import { InternalLinkDialog } from "./InternalLinkDialog";
import { findInternalLinkHeading } from "@/lib/internal-links";
import { requestLogJson } from "@/lib/client-http";
import type { SearchSelection } from "./SearchBox";
import type { FavoritesController } from "@/hooks/use-favorites";
import type { MarkdownHeading } from "@/lib/markdown-outline";
import { FavoriteGroupDialog } from "./FavoriteGroupDialog";
import { FavoriteRemovePopover, FavoriteSuccessNotice } from "./FavoriteFeedback";
import { ExportMenu } from "./ExportMenu";
import type { ExportScope } from "@/hooks/use-export";
import "@/app/reader.css";

export type WorkspaceMode = "preview" | "source" | "split";
interface Editing {
  mode: WorkspaceMode; onMode: (value: WorkspaceMode) => void;
  documentDate: string; body: string; dirty: boolean; busy: boolean; saved: boolean; error: string; conflict: boolean;
  resetRevision: number;
  locked: boolean;
  onChange: (value: string) => void; onSave: () => void; onReload: () => void; onDiscard: () => void;
  onDelete: () => void; onBackups: () => void;
}
interface Props {
  editing: Editing;
  search: SearchSelection | null;
  favorites: FavoritesController;
  exporting: { run: (scope: ExportScope) => Promise<boolean>; busy: boolean };
  active: boolean;
  navigationRevision: number;
  day: DayEntry | null; date: string; heading: string; scrollTarget: number | null;
  loading: boolean; error: string; theme: "light" | "dark"; reading: boolean;
  onReading: (value: boolean) => void; onRetry: () => void;
  onNavigate: (date: string, heading?: string) => Promise<boolean>;
}

export function LogReader({ editing, search, favorites, exporting, active, navigationRevision, day, date, heading, scrollTarget, loading, error, theme, reading, onReading, onRetry, onNavigate }: Props) {
  const content = useMemo(() => editing.documentDate === date ? editing.body : day ? toEditableDayBody(day.date, day.content) : "", [editing.documentDate, editing.body, date, day]);
  const headings = useMemo(() => buildMarkdownOutline(content), [content]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [favoriteGroup, setFavoriteGroup] = useState("");
  const [favoriteFeedback, setFavoriteFeedback] = useState<{ id: string; title: string; kind: "added" | "remove"; top: number; left: number } | null>(null);
  const favoriteEpoch = useRef(0);
  useEffect(() => {
    favoriteEpoch.current++;
    setFavoriteGroup(""); setFavoriteFeedback(null);
    return () => { favoriteEpoch.current++; };
  }, [active, date]);
  const favoriteByHeading = useMemo(() => new Map(favorites.favorites.filter(item => item.date === date && item.exists).map(item => [item.resolvedHeadingId, item])), [favorites.favorites, date]);
  async function toggleFavorite(item: MarkdownHeading, button: HTMLButtonElement) {
    if (!active || favorites.busy || editing.dirty) return;
    const rect = button.getBoundingClientRect();
    const point = { top: rect.top + rect.height / 2, left: rect.left - 8 };
    const favorite = favoriteByHeading.get(item.id);
    if (favorite) { setFavoriteFeedback({ ...point, id: favorite.id, title: item.text, kind: "remove" }); return; }
    const epoch = favoriteEpoch.current;
    const saved = await favorites.add({ date, headingText: item.text, headingId: item.id, level: 3 });
    if (saved && epoch === favoriteEpoch.current) setFavoriteFeedback({ ...point, id: saved.id, title: item.text, kind: "added" });
  }
  const [actionsOpen, setActionsOpen] = useState(false);
  const actions = useRef<HTMLElement>(null);
  const [activeHeading, setActiveHeading] = useState("");
  const outline = useRef<HTMLElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [linkSelection, setLinkSelection] = useState<{ view: EditorView; range: InsertionRange; alias: string; document: string } | null>(null);
  const preview = useRef<HTMLElement>(null);
  const restorePending = useRef(false);
  const [linkError, setLinkError] = useState("");
  const [returnPoint, setReturnPoint] = useState<{ date: string; heading: string; mode: WorkspaceMode } | null>(null);
  const returning = useRef(false);
  const linkRequest = useRef(0);
  const currentNavigation = useRef(navigationRevision);
  currentNavigation.current = navigationRevision;
  const position = useReadingPosition({ editor: () => editorView.current, preview: () => preview.current,
    toolbarBottom: () => toolbar.current?.getBoundingClientRect().bottom || 0 });
  const linkPosition = useReadingPosition({ editor: () => editorView.current, preview: () => preview.current,
    toolbarBottom: () => toolbar.current?.getBoundingClientRect().bottom || 0 });
  const ready = Boolean(day?.exists && !loading && !error);
  const exportScopes = [{ scope: "day" as const, label: "当前日块", disabled: !ready }, { scope: "file" as const, label: "当前源文件", disabled: !ready }, { scope: "all" as const, label: "全部日志" }];
  const editorReady = Boolean(date && editing.documentDate === date);
  const mode = reading ? "preview" : editing.mode;
  const attachments = useEditorAttachments(date, active && !editing.locked && mode !== "preview", editing.resetRevision, () => editorView.current);
  const imageFiles = (files: FileList) => Array.from(files).filter(file => file.type.startsWith("image/"));
  function openLink() {
    const view = editorView.current;
    if (!view || !active) return;
    const { from, to } = view.state.selection.main;
    setLinkSelection({ view, range: { from, to, valid: true }, alias: view.state.doc.sliceString(from, to), document: view.state.doc.toString() });
  }
  const openInternalLink = useCallback(async (target: InternalLinkTarget) => {
    const attempt = ++linkRequest.current;
    setLinkError("");
    try {
      const targetDate = target.date || date;
      if (target.date) {
        const result = await requestLogJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(targetDate)}`);
        if (attempt !== linkRequest.current || currentNavigation.current !== navigationRevision) return;
        if (!result.day.exists) { setLinkError("未找到目标日块"); return; }
      }
      linkPosition.capture(mode);
      if (await onNavigate(targetDate, target.headingText) && attempt === linkRequest.current) {
        setReturnPoint({ date, heading, mode }); editing.onMode("preview");
      }
    } catch (error) {
      if (attempt === linkRequest.current && !(error instanceof Error && error.name === "AbortError")) setLinkError(error instanceof Error ? error.message : "内部链接跳转失败");
    }
  }, [date, heading, mode, navigationRevision, onNavigate, editing.onMode, linkPosition.capture]);
  async function returnFromLink() {
    if (!returnPoint || !(await onNavigate(returnPoint.date, returnPoint.heading))) return;
    returning.current = true; editing.onMode(returnPoint.mode); setLinkError("");
  }
  function changeMode(next: WorkspaceMode) {
    if (next === mode) return;
    position.capture(mode); restorePending.current = true; editing.onMode(next);
  }
  function changeReading(value: boolean) { position.capture(mode); restorePending.current = true; onReading(value); }
  useEffect(() => {
    if (!active || !restorePending.current) return;
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
  }, [active, mode, reading, editorReady, position.restore]);

  useEffect(() => { setOutlineOpen(false); setActionsOpen(false); }, [date, reading]);
  useEffect(() => { setLinkError(""); }, [date]);
  useEffect(() => { if (!active) { linkRequest.current++; setOutlineOpen(false); setActionsOpen(false); } }, [active]);
  useEffect(() => { setLinkSelection(null); }, [date, active]);
  useEffect(() => {
    if (!actionsOpen || !actions.current) return;
    const release = containModalFocus(actions.current, () => setActionsOpen(false));
    const unlock = lockBodyScroll();
    return () => { release(); unlock(); };
  }, [actionsOpen]);
  useEffect(() => {
    if (!outlineOpen || !outline.current) return;
    const release = containModalFocus(outline.current, () => setOutlineOpen(false));
    const unlock = lockBodyScroll();
    return () => { release(); unlock(); };
  }, [outlineOpen]);
  useEffect(() => {
    const element = toolbar.current;
    if (!active || !element) return;
    const update = () => {
      const reader = element.closest<HTMLElement>(".reader");
      reader?.style.setProperty("--reader-toolbar-height", `${element.offsetHeight}px`);
      reader?.style.setProperty("--reader-toolbar-bottom", `${element.getBoundingClientRect().bottom}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); update();
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [active, reading]);
  useEffect(() => {
    if (!active || !ready || !editorReady) return;
    const frame = requestAnimationFrame(() => {
      if (scrollTarget !== null) { window.scrollTo({ top: scrollTarget, behavior: "instant" }); return; }
      const target = findInternalLinkHeading(headings, heading);
      const element = target ? document.getElementById(target.id) : null;
      if (element) window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - (toolbar.current?.getBoundingClientRect().bottom || 0) - 12), behavior: "instant" });
      else window.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, ready, editorReady, date, heading, scrollTarget, navigationRevision]);
  useEffect(() => {
    if (!active || !returning.current || !returnPoint || date !== returnPoint.date || loading || !editorReady) return;
    let frame = 0, attempts = 0;
    const restore = () => { frame = requestAnimationFrame(() => {
      if (linkPosition.restore(mode) || ++attempts >= 6) { returning.current = false; setReturnPoint(null); }
      else restore();
    }); };
    restore(); return () => cancelAnimationFrame(frame);
  }, [active, date, loading, editorReady, mode, returnPoint, linkPosition.restore]);
  useEffect(() => {
    if (!active || !search || !ready || !editorReady || mode !== "preview") return;
    const frame = requestAnimationFrame(() => {
      const hit = preview.current?.querySelector<HTMLElement>(search.scope === "heading" ? "h3 .search-hit-highlight" : ".search-hit-highlight");
      if (hit) window.scrollTo({ top: Math.max(0, window.scrollY + hit.getBoundingClientRect().top - (toolbar.current?.getBoundingClientRect().bottom || 0) - 12), behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, search, ready, editorReady, mode, navigationRevision]);
  useEffect(() => {
    if (!active || !ready) return;
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
  }, [active, ready, headings]);

  const outlineButton = <button className="mobile-toolbar-icon" type="button" aria-label="打开日志大纲" disabled={!headings.length || !ready} onClick={() => setOutlineOpen(true)}><List size={18} /></button>;
  const modes = [["preview", "浏览", Eye], ["source", "源码", Edit3], ["split", "分屏", FileText]] as const;
  const modeButtons = (mobile = false) => <div className={mobile ? "mobile-mode-switch" : "view-mode-switch"} role="group" aria-label="工作区模式">{modes.filter(([value]) => !mobile || value !== "split").map(([value, label, Icon]) => <button key={value} type="button" className={`view-mode-button${(mode === value || (mobile && mode === "split" && value === "source")) ? " active" : ""}`} aria-pressed={mode === value || (mobile && mode === "split" && value === "source")} onClick={() => changeMode(value)}><Icon size={15} />{label}</button>)}</div>;
  const saveButton = (mobile = false) => <button className={mobile ? "mobile-toolbar-icon primary" : "button primary toolbar-save-button"} type="button" aria-label={editing.busy ? "保存中" : "保存"} disabled={!editorReady || !active || editing.busy || (!editing.dirty && Boolean(day?.exists))} onClick={editing.onSave}><Save size={15} />{!mobile && (editing.busy ? "保存中" : "保存")}</button>;
  const renderOutline = (popup: boolean) => <nav className="preview-outline" aria-label="当前日志大纲" ref={popup ? outline : undefined} role={popup ? "dialog" : undefined} aria-modal={popup ? true : undefined}>
    {popup && <button className="mobile-outline-close" type="button" aria-label="关闭大纲" onClick={() => setOutlineOpen(false)}><X size={18} /></button>}
    <div className="preview-outline-inner"><div className="preview-outline-title">目录</div><div className="preview-outline-list">
      {headings.map(item => <div className={`outline-row${item.id === activeHeading ? " active" : ""}`} key={item.id} style={{ "--outline-indent": `${Math.max(0, item.level - (headings[0]?.level || 3)) * 12}px` } as CSSProperties}>
        <button className="outline-item" type="button" title={item.text} aria-current={item.id === activeHeading ? "location" : undefined} onClick={() => { setOutlineOpen(false); onNavigate(date, item.id); }}>{item.text}</button>
        {item.level === 3 && <button className={`outline-favorite${favoriteByHeading.has(item.id) ? " active" : ""}`} type="button" disabled={!favorites.loaded || favorites.busy || editing.dirty} title={editing.dirty ? "保存修改后可收藏小节" : favoriteByHeading.has(item.id) ? "取消收藏" : "收藏小节"} aria-label={`${favoriteByHeading.has(item.id) ? "取消收藏" : "收藏章节"}：${item.text}`} aria-pressed={favoriteByHeading.has(item.id)} onClick={event => void toggleFavorite(item, event.currentTarget)}><Star size={14} fill={favoriteByHeading.has(item.id) ? "currentColor" : "none"} /></button>}
      </div>)}
    </div></div>
  </nav>;

  return <>
    <div className="reader-toolbar-container" ref={toolbar}><div className={`reader-toolbar reader-toolbar-log${reading ? " reading-active" : ""}`}>
      <div className="reading-mode-toolbar"><div className="reading-mode-identity"><BookOpen size={18} /><h2>{date}</h2></div><div className="reading-mode-actions">{outlineButton}<button className="button secondary" type="button" onClick={() => changeReading(false)}>退出阅读</button></div></div>
      <div className="reader-log-identity"><span className="eyebrow">{day?.fileName || "Markdown"}</span><div className="reader-heading-row"><h2>{date || "未选择日期"}</h2></div></div>
      <div className="reader-controls reader-log-controls"><ExportMenu scopes={exportScopes} onExport={exporting.run} busy={exporting.busy} disabled={!active} />{returnPoint && <button className="button secondary" type="button" aria-label="返回链接前位置" onClick={() => void returnFromLink()}><CornerUpLeft size={15} /></button>}{mode !== "preview" && <div className="toolbar-actions editor-toolbar-actions">
        <button className="button secondary" type="button" disabled={!editorReady || attachments.busy} onClick={openLink}><Link2 size={15} />内部链接</button>
        <button className="button secondary" type="button" disabled={!editorReady || attachments.busy} onClick={() => imageInput.current?.click()}><Upload size={15} />插入图片</button>
      </div>}<button className="button secondary icon-only" type="button" aria-label="备份与恢复" title="备份与恢复" disabled={!date || editing.busy} onClick={editing.onBackups}><DatabaseBackup size={16} /></button><button className="button secondary icon-only" type="button" aria-label="删除当前日块" title="删除当前日块" disabled={!day?.exists || editing.busy} onClick={editing.onDelete}><Trash2 size={16} /></button><div className="reader-mode-actions">{modeButtons()}<select className="log-mode-select" value={mode} aria-label="工作区模式" onChange={event => changeMode(event.target.value as WorkspaceMode)}>{modes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="reader-outline-access">{outlineButton}</div>{saveButton()}</div>
      <div className="mobile-log-toolbar"><div className="mobile-log-identity"><strong>{date || "未选择日期"}</strong></div><div className="mobile-log-actions">{modeButtons(true)}{saveButton(true)}<button className="mobile-toolbar-icon" type="button" aria-label="更多日志操作" onClick={() => setActionsOpen(true)}><MoreHorizontal size={19} /></button></div></div>
    </div></div>
    <div className={`reader-content editing-workspace mode-${mode}`}>
    {linkError && <div className="editor-navigation-status" role="alert">{linkError}</div>}
    {favorites.error && <div className="editor-navigation-status" role="alert">{favorites.error}<button className="button secondary" type="button" onClick={() => void favorites.reload()}>重试收藏</button></div>}
    {ready && heading && !findInternalLinkHeading(headings, heading) && <div className="editor-navigation-status" role="status">未找到目标小节，已打开该日日志。</div>}
    <input ref={imageInput} type="file" multiple accept={IMAGE_ACCEPT} hidden aria-label="选择日志图片" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void attachments.upload(files); }} />
    {attachments.status && <div className="editor-attachment-status" role={attachments.failed ? "alert" : "status"}>{attachments.status}</div>}
    {(editing.error || editing.dirty || editing.saved) && <div className="editor-save-status" role={editing.error ? "alert" : "status"}>{editing.error || (editing.dirty ? "有未保存修改" : "已保存")}{editing.dirty && <button className="button secondary" type="button" disabled={editing.busy} onClick={editing.onDiscard}>放弃修改</button>}{editing.conflict && <button className="button secondary" type="button" onClick={editing.onReload}>重新读取</button>}</div>}
    <div className="reader-preview-pane" style={{ display: mode === "source" ? "none" : undefined }}>
    {loading ? <div className="preview-loading" role="status">正在读取日志…</div> : error ? <div className="preview-empty" role="alert"><p>{error}</p><button className="button secondary" onClick={onRetry}>重试</button></div> : !day?.exists && !content.trim() ? <div className="preview-empty"><p>{date ? "这一天暂无学习日志" : "暂无学习日志，请从左侧选择日期"}</p></div> : <div className={`preview-workspace${headings.length && mode === "preview" ? " has-outline" : ""}`}>
      <div className="preview-pane"><MarkdownPreview active={active} containerRef={preview} content={content} headings={headings} themeMode={theme} textHighlight={search || undefined} onInternalLink={openInternalLink} />
        {!reading && <button className="button preview-reading-mode-entry" type="button" aria-label="进入阅读模式" onClick={() => changeReading(true)}><Maximize2 size={18} /></button>}
      </div>{headings.length > 0 && mode === "preview" && renderOutline(false)}
    </div>}
    </div>
    <div className="source-workspace" style={{ display: mode === "preview" ? "none" : undefined }} inert={!active || mode === "preview"}
      onPasteCapture={event => { const files = imageFiles(event.clipboardData.files); if (files.length) { event.preventDefault(); void attachments.upload(files); } }}
      onDropCapture={event => { const files = imageFiles(event.dataTransfer.files); if (files.length) { event.preventDefault(); void attachments.upload(files); } }}
      onDragOver={event => { if (Array.from(event.dataTransfer.items).some(item => item.type.startsWith("image/"))) event.preventDefault(); }}>
      {editorReady ? <LogEditor date={date} value={editing.body} active={active && !editing.locked && mode !== "preview"} onChange={editing.onChange} onSave={editing.onSave} onUpdate={attachments.update} onView={view => { editorView.current = view; }} /> : <div className="source-empty">{loading ? "正在读取日志…" : "选择日期以编辑学习日志"}</div>}
    </div></div>
    {active && favoriteFeedback?.kind === "added" && <FavoriteSuccessNotice {...favoriteFeedback} onClose={() => setFavoriteFeedback(null)} onGroup={() => { setOutlineOpen(false); setFavoriteGroup(favoriteFeedback.id); }} />}
    {active && favoriteFeedback?.kind === "remove" && <FavoriteRemovePopover {...favoriteFeedback} busy={favorites.busy} error={favorites.error} onClose={() => setFavoriteFeedback(null)} onConfirm={() => favorites.remove(favoriteFeedback.id)} />}
    {active && favoriteGroup && <FavoriteGroupDialog favoriteId={favoriteGroup} favorites={favorites} onClose={() => setFavoriteGroup("")} />}
    {outlineOpen && <div className="reader-outline-modal mobile-panel-outline" onClick={() => setOutlineOpen(false)}><div onClick={event => event.stopPropagation()}>{renderOutline(true)}</div></div>}
    {actionsOpen && <div className="mobile-sheet-backdrop" onClick={() => setActionsOpen(false)}><section className="mobile-action-sheet" ref={actions} role="dialog" aria-modal="true" aria-label="日志操作" onClick={event => event.stopPropagation()}>
      <div className="mobile-sheet-header"><div><strong>日志操作</strong><span>{date}</span></div><button type="button" aria-label="关闭日志操作" onClick={() => setActionsOpen(false)}><X size={18} /></button></div>
      <div className="mobile-sheet-grid">
        <ExportMenu variant="items" scopes={exportScopes.map(item => ({ ...item, label: `导出${item.label}` }))} busy={exporting.busy} disabled={!active} onExport={scope => { setActionsOpen(false); return exporting.run(scope); }} />
        <button type="button" disabled={!date || editing.busy} onClick={() => { setActionsOpen(false); editing.onBackups(); }}><DatabaseBackup size={18} />备份与恢复</button>
        <button type="button" disabled={!day?.exists || editing.busy} onClick={() => { setActionsOpen(false); editing.onDelete(); }}><Trash2 size={18} />删除当前日块</button>
        {returnPoint && <button type="button" onClick={() => { setActionsOpen(false); void returnFromLink(); }}><CornerUpLeft size={18} />返回链接前位置</button>}
        <button type="button" disabled={!editorReady || mode === "preview" || attachments.busy} onClick={() => { setActionsOpen(false); openLink(); }}><Link2 size={18} />内部链接</button>
        <button type="button" disabled={!editorReady || mode === "preview" || attachments.busy} onClick={() => { setActionsOpen(false); imageInput.current?.click(); }}><Upload size={18} />插入图片</button>
        <button type="button" disabled={!date || editing.busy} onClick={() => { setActionsOpen(false); editing.onReload(); }}><RefreshCw size={18} />刷新</button>
        <button type="button" disabled={!headings.length} onClick={() => { setActionsOpen(false); editing.onMode("preview"); setOutlineOpen(true); }} aria-label="打开日志大纲"><List size={18} />大纲</button>
        <button type="button" disabled={!ready} onClick={() => { setActionsOpen(false); changeReading(true); }} aria-label="进入阅读模式"><Maximize2 size={18} />阅读模式</button>
        <button type="button" disabled={!editing.dirty || editing.busy} onClick={() => { setActionsOpen(false); editing.onDiscard(); }}><Eye size={18} />放弃修改</button>
      </div>
    </section></div>}
    {linkSelection && active && createPortal(<InternalLinkDialog initialAlias={linkSelection.alias} onClose={() => setLinkSelection(null)} onInsert={markdown => {
      if (editorView.current === linkSelection.view && linkSelection.view.state.doc.toString() === linkSelection.document) insertAtRange(linkSelection.view, linkSelection.range, markdown);
      setLinkSelection(null);
    }} />, document.body)}
  </>;
}

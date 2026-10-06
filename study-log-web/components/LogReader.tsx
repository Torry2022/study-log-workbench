"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronLeft, ChevronRight, CornerUpLeft, DatabaseBackup, Edit3, Eye, FileText, FileX2, LayoutList, Link2, Maximize2, Minimize2, MoreHorizontal, PanelRightOpen, RefreshCw, Save, Star, Trash2, Upload, X } from "lucide-react";
import { MarkdownPreview, type InternalLinkTarget } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { toEditableDayBody } from "@/lib/day-content";
import { containModalFocus, lockBodyScroll } from "@/hooks/use-dialog-exit";
import type { DayEntry } from "@/lib/types";
import { LogEditor } from "./LogEditor";
import { MarkdownEditMenu } from "./MarkdownEditMenu";
import { applyMarkdownEdit } from "@/lib/editor-commands";
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
import { WorkspaceState } from "./WorkspaceState";
import { AppFeedback } from "./AppFeedback";
import "@/app/feedback.css";
import type { ExportScope } from "@/hooks/use-export";
import "@/app/reader.css";

export type WorkspaceMode = "preview" | "source" | "split";
interface Editing {
  mode: WorkspaceMode; onMode: (value: WorkspaceMode) => void;
  documentDate: string; body: string; dirty: boolean; busy: boolean; saved: boolean; error: string; conflict: boolean;
  resetRevision: number;
  locked: boolean;
  onChange: (value: string) => void; onSave: () => void; onReload: () => void; onDiscard: () => void; onDismissError: () => void;
  onDelete: () => void; onBackups: () => void;
}
interface Props {
  onOpenAi?: () => void;
  onOpenFavorites?: () => void;
  navigation?: {
    previousDate: string | null; nextDate: string | null; showAdjacent: boolean;
    onReturnNotes?: () => void; onReturnRag?: () => void;
  };
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

export function LogReader({ onOpenAi, onOpenFavorites, navigation, editing, search, favorites, exporting, active, navigationRevision, day, date, heading, scrollTarget, loading, error, theme, reading, onReading, onRetry, onNavigate }: Props) {
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
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const toolbarMenuTrigger = useRef<HTMLButtonElement>(null);
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
  const [missingHeading, setMissingHeading] = useState(false);
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
  // Validate the destination once against the saved document at navigation time.
  // Editing a heading afterwards must not turn a successful navigation into an error.
  useEffect(() => {
    setMissingHeading(Boolean(active && ready && editorReady && heading && day &&
      !findInternalLinkHeading(buildMarkdownOutline(toEditableDayBody(day.date, day.content)), heading)));
  }, [active, ready, editorReady, date, heading, navigationRevision]);
  useEffect(() => { if (mode !== "preview" || editing.dirty) setMissingHeading(false); }, [mode, editing.dirty]);
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
  useEffect(() => { setToolbarMenuOpen(false); }, [active, date, reading, mode]);
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

  const outlineButton = <button className="reading-mode-icon" type="button" title="打开大纲" aria-label="打开日志大纲" disabled={!headings.length || !ready} onClick={() => setOutlineOpen(true)}><LayoutList size={17} /></button>;
  const modes = [["preview", "浏览", Eye], ["source", "源码", Edit3], ["split", "分屏", FileText]] as const;
  const modeButtons = (mobile = false) => <div className={mobile ? "mobile-mode-switch" : "view-mode-switch"} role="group" aria-label="工作区模式">{modes.filter(([value]) => !mobile || value !== "split").map(([value, label, Icon]) => <button key={value} type="button" className={`${mobile ? "" : "view-mode-button"}${(mode === value || (mobile && mode === "split" && value === "source")) ? " active" : ""}`} title={label} aria-label={label} aria-pressed={mode === value || (mobile && mode === "split" && value === "source")} onClick={() => changeMode(value)}><Icon size={mobile ? 16 : 15} />{label}</button>)}</div>;
  const saveButton = (mobile = false) => <button className={mobile ? "mobile-toolbar-icon primary" : "button primary toolbar-save-button"} type="button" title={editing.busy ? "保存中" : "保存"} aria-label={editing.busy ? "保存中" : "保存"} disabled={!editorReady || !active || editing.busy || (!editing.dirty && Boolean(day?.exists))} onClick={editing.onSave}>{mobile && editing.busy ? <RefreshCw className="mobile-spinner" size={17} /> : <Save size={mobile ? 17 : 15} />}{!mobile && (editing.busy ? "保存中" : "保存")}</button>;
  const dayNavigator = () => (returnPoint || navigation?.onReturnRag || navigation?.showAdjacent) && <div className="day-navigator" aria-label="日块浏览导航">
    {returnPoint && <button className="day-nav-button" type="button" disabled={editing.busy} title="返回内部链接跳转前的位置" aria-label="返回链接前位置" onClick={() => void returnFromLink()}><CornerUpLeft size={14} />返回</button>}
    {navigation?.onReturnRag && <button className="day-nav-button" type="button" disabled={editing.busy} title="返回知识问答" aria-label="返回问答" onClick={navigation.onReturnRag}><CornerUpLeft size={14} />返回问答</button>}
    {navigation?.showAdjacent && <>
      <button className="day-nav-button" type="button" disabled={!navigation.previousDate || editing.busy} title="上一篇" aria-label="上一篇" onClick={() => navigation.previousDate && void onNavigate(navigation.previousDate)}><ChevronLeft size={14} />上一篇</button>
      <button className="day-nav-button" type="button" disabled={!navigation.nextDate || editing.busy} title="下一篇" aria-label="下一篇" onClick={() => navigation.nextDate && void onNavigate(navigation.nextDate)}>下一篇<ChevronRight size={14} /></button>
    </>}
  </div>;
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
      <div className="reading-mode-toolbar"><div className="reading-mode-identity"><BookOpen size={17} /><h2>{date}</h2></div><div className="reading-mode-actions">{dayNavigator()}{outlineButton}<button className="reading-mode-icon" type="button" aria-label="退出阅读" title="退出阅读模式" onClick={() => changeReading(false)}><Minimize2 size={17} /></button></div></div>
      <div className="reader-log-identity"><span className="eyebrow">{day?.fileName || "Markdown"}</span><div className="reader-heading-row"><h2>{date || "未选择日期"}</h2><div className="reader-navigator-desktop">{dayNavigator()}</div></div></div>
      <div className="reader-controls reader-log-controls">
        <div className="reader-secondary-actions">
          {navigation?.onReturnNotes && <button className="button secondary" type="button" onClick={navigation.onReturnNotes}><CornerUpLeft size={15} />返回随记</button>}
          {mode !== "preview" && <div className="toolbar-actions editor-toolbar-actions">
            <button className="button secondary" type="button" title="内部链接" aria-label="内部链接" disabled={!editorReady || attachments.busy || editing.busy} onClick={openLink}><Link2 size={15} />内部链接</button>
            <button className="button secondary" type="button" title="插入图片" aria-label="插入图片" disabled={!editorReady || attachments.busy || editing.busy} onClick={() => imageInput.current?.click()}><Upload size={15} />插入图片</button>
            <button className="button secondary" type="button" disabled={!editing.dirty || editing.busy} onClick={editing.onDiscard}><Eye size={15} />放弃修改</button>
          </div>}
        </div>
        <div className="reader-mode-actions"><select className="log-mode-select" value={mode} aria-label="工作区模式" onChange={event => changeMode(event.target.value as WorkspaceMode)}>{modes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>{modeButtons()}</div>
        <div className="toolbar-actions day-toolbar-actions">
          <button className="button secondary log-action-refresh" type="button" title="刷新" aria-label="刷新" disabled={!date || editing.busy} onClick={editing.onReload}><RefreshCw size={15} />刷新</button>
          <ExportMenu scopes={exportScopes} onExport={exporting.run} busy={exporting.busy} disabled={!active} />
          <button className="button secondary log-action-backup" type="button" aria-label="备份与恢复" title="备份" disabled={!date || editing.busy} onClick={editing.onBackups}><DatabaseBackup size={15} />备份</button>
          <button className="button danger toolbar-danger-action log-action-delete" type="button" aria-label="删除当前日块" title="删除" disabled={!day?.exists || editing.busy} onClick={editing.onDelete}><Trash2 size={15} />删除</button>
          <div className="log-toolbar-more export-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setToolbarMenuOpen(false); }} onKeyDown={event => { if (event.key === "Escape" && toolbarMenuOpen) { event.preventDefault(); event.stopPropagation(); setToolbarMenuOpen(false); toolbarMenuTrigger.current?.focus(); } }}>
            <button ref={toolbarMenuTrigger} className="button secondary" type="button" title="更多日志操作" aria-label="更多操作" aria-expanded={toolbarMenuOpen} aria-controls="log-toolbar-popover" onClick={() => setToolbarMenuOpen(value => !value)}><MoreHorizontal size={18} /></button>
            {toolbarMenuOpen && <div id="log-toolbar-popover" className="export-popover log-toolbar-popover" role="group" aria-label="更多日志操作" onClick={event => { if (event.target instanceof Element && event.target.closest("button")) { toolbarMenuTrigger.current?.focus({ preventScroll: true }); setToolbarMenuOpen(false); } }}>
              <div className="log-overflow-navigation">{dayNavigator()}</div>
              {navigation?.onReturnNotes && <button type="button" onClick={navigation.onReturnNotes}>返回随记</button>}
              {mode !== "preview" && <>
                <button type="button" disabled={!editorReady || attachments.busy || editing.busy} onClick={openLink}>内部链接</button>
                <button type="button" disabled={!editorReady || attachments.busy || editing.busy} onClick={() => imageInput.current?.click()}>插入图片</button>
                <button type="button" disabled={!editing.dirty || editing.busy} onClick={editing.onDiscard}>放弃修改</button>
              </>}
              <button className="log-overflow-refresh" type="button" disabled={!date || editing.busy} onClick={editing.onReload}>刷新</button>
              <div className="log-overflow-export"><ExportMenu variant="items" scopes={exportScopes.map(item => ({ ...item, label: `导出${item.label}` }))} onExport={exporting.run} busy={exporting.busy} disabled={!active} /></div>
              <button className="log-overflow-backup" type="button" aria-label="备份与恢复" disabled={!date || editing.busy} onClick={editing.onBackups}>备份</button>
              <button className="log-overflow-delete danger" type="button" aria-label="删除当前日块" disabled={!day?.exists || editing.busy} onClick={editing.onDelete}>删除</button>
            </div>}
          </div>
          {saveButton()}
        </div>
      </div>
      <div className="mobile-log-toolbar"><div className="mobile-log-identity"><strong>{date || "未选择日期"}</strong></div><div className="mobile-log-actions">{modeButtons(true)}{saveButton(true)}<button className="mobile-toolbar-icon" type="button" aria-label="更多日志操作" onClick={() => setActionsOpen(true)}><MoreHorizontal size={19} /></button></div></div>
    </div></div>
    <div className={`reader-content editing-workspace mode-${mode}`}>
    {linkError && <div className="editor-navigation-status" role="alert">{linkError}</div>}
    {favorites.error && <div className="editor-navigation-status" role="alert">{favorites.error}<button className="button secondary" type="button" onClick={() => void favorites.reload()}>重试收藏</button></div>}
    {missingHeading && <div className="editor-navigation-status" role="status">未找到目标小节，已打开该日日志。<button className="button secondary" type="button" onClick={() => setMissingHeading(false)}>关闭</button></div>}
    <input ref={imageInput} type="file" multiple accept={IMAGE_ACCEPT} hidden aria-label="选择日志图片" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void attachments.upload(files); }} />
    {attachments.status && <div className="editor-attachment-status" role={attachments.failed ? "alert" : "status"}>{attachments.status}</div>}
    {editing.error && <AppFeedback message={editing.error} tone="error" onDismiss={editing.onDismissError} action={editing.conflict ? { label: "重新读取", onClick: editing.onReload } : undefined} />}
    {active && editing.saved && !editing.dirty && !editing.error && <AppFeedback message="已保存" tone="success" onDismiss={() => {}} />}
    <div className="reader-preview-pane" style={{ display: mode === "source" ? "none" : undefined }}>
    {loading || error || !content.trim() ? <div className={`preview-workspace${(loading || error) && mode === "preview" ? " has-outline" : ""}`}><div className="preview-pane">
      {loading ? <WorkspaceState kind="loading" title={`正在加载 ${date}`} className="preview-loading" /> : error ? <WorkspaceState kind="error" title="日志加载失败" description={error} className="preview-empty" actions={<button className="button secondary" type="button" onClick={onRetry}><RefreshCw size={15} />重新加载</button>} /> : <WorkspaceState kind="empty" icon={FileX2} title={date ? "暂无正文" : "选择左侧日期，或新建今天的学习日志"} className="preview-empty" />}
    </div></div> : <div className={`preview-workspace${headings.length && mode === "preview" ? " has-outline" : ""}`}>
      <div className="preview-pane"><MarkdownPreview active={active} containerRef={preview} content={content} headings={headings} themeMode={theme} textHighlight={search || undefined} onInternalLink={openInternalLink} />
        {!reading && <button className="reading-mode-entry preview-reading-mode-entry" type="button" aria-label="进入阅读模式" title="进入阅读模式" onClick={() => changeReading(true)}><Maximize2 size={18} /></button>}
      </div>{headings.length > 0 && mode === "preview" && renderOutline(false)}
    </div>}
    </div>
    <div className="source-workspace" style={{ display: mode === "preview" ? "none" : undefined }} inert={!active || mode === "preview"}
      onPasteCapture={event => { const files = imageFiles(event.clipboardData.files); if (files.length) { event.preventDefault(); void attachments.upload(files); } }}
      onDropCapture={event => { const files = imageFiles(event.dataTransfer.files); if (files.length) { event.preventDefault(); void attachments.upload(files); } }}
      onDragOver={event => { if (Array.from(event.dataTransfer.items).some(item => item.type.startsWith("image/"))) event.preventDefault(); }}>
      {editorReady ? <LogEditor date={date} value={editing.body} active={active && !editing.locked && mode !== "preview"} onChange={editing.onChange} onSave={editing.onSave} onUpdate={attachments.update} onView={view => { editorView.current = view; }}
        tools={<MarkdownEditMenu disabled={!active || editing.locked || attachments.busy} onCommand={command => { if (editorView.current) applyMarkdownEdit(editorView.current, command); }} onInternalLink={openLink} onImage={() => imageInput.current?.click()} />}
      /> : <WorkspaceState kind={error ? "error" : loading ? "loading" : "empty"} title={error ? "日志加载失败" : loading ? `正在加载 ${date}` : "选择左侧日期，或新建今天的学习日志"} description={error || undefined} className="source-empty" actions={error ? <button className="button secondary" type="button" onClick={onRetry}><RefreshCw size={15} />重新加载</button> : undefined} />}
    </div></div>
    {active && favoriteFeedback?.kind === "added" && <FavoriteSuccessNotice {...favoriteFeedback} onClose={() => setFavoriteFeedback(null)} onGroup={() => { setOutlineOpen(false); setFavoriteGroup(favoriteFeedback.id); }} />}
    {active && favoriteFeedback?.kind === "remove" && <FavoriteRemovePopover {...favoriteFeedback} busy={favorites.busy} error={favorites.error} onClose={() => setFavoriteFeedback(null)} onConfirm={() => favorites.remove(favoriteFeedback.id)} />}
    {active && favoriteGroup && <FavoriteGroupDialog favoriteId={favoriteGroup} favorites={favorites} onClose={() => setFavoriteGroup("")} onOpenCenter={onOpenFavorites} />}
    {outlineOpen && <div className="reader-outline-modal mobile-panel-outline" onClick={() => setOutlineOpen(false)}><div onClick={event => event.stopPropagation()}>{renderOutline(true)}</div></div>}
    {actionsOpen && <div className="mobile-sheet-backdrop" onClick={() => setActionsOpen(false)}><section className="mobile-action-sheet" ref={actions} role="dialog" aria-modal="true" aria-label="日志操作" onClick={event => event.stopPropagation()}>
      <div className="mobile-sheet-header"><div><strong>日志操作</strong><span>{date || "未选择日期"}</span><span>{day?.fileName || "Markdown"}</span></div><button type="button" aria-label="关闭日志操作" onClick={() => setActionsOpen(false)}><X size={18} /></button></div>
      <div className="mobile-sheet-grid">
        {returnPoint && <button type="button" aria-label="返回链接前位置" disabled={editing.busy} onClick={() => { setActionsOpen(false); void returnFromLink(); }}><CornerUpLeft size={18} />返回</button>}
        {navigation?.onReturnRag && <button type="button" disabled={editing.busy} onClick={() => { setActionsOpen(false); navigation.onReturnRag?.(); }}><CornerUpLeft size={18} />返回问答</button>}
        {navigation?.onReturnNotes && <button type="button" disabled={editing.busy} onClick={() => { setActionsOpen(false); navigation.onReturnNotes?.(); }}><CornerUpLeft size={18} />返回随记</button>}
        <button type="button" disabled={!navigation?.previousDate || editing.busy} onClick={() => { setActionsOpen(false); if (navigation?.previousDate) void onNavigate(navigation.previousDate); }}><ChevronLeft size={18} />上一篇</button>
        <button type="button" disabled={!navigation?.nextDate || editing.busy} onClick={() => { setActionsOpen(false); if (navigation?.nextDate) void onNavigate(navigation.nextDate); }}><ChevronRight size={18} />下一篇</button>
        {mode !== "preview" && <button type="button" disabled={!editorReady || attachments.busy || editing.busy} onClick={() => { setActionsOpen(false); openLink(); }}><Link2 size={18} />内部链接</button>}
        <button type="button" disabled={!date || editing.busy} onClick={() => { setActionsOpen(false); editing.onReload(); }}><RefreshCw size={18} />刷新</button>
        <button type="button" disabled={!headings.length || !ready} onClick={() => { setActionsOpen(false); editing.onMode("preview"); setOutlineOpen(true); }} aria-label="打开日志大纲"><LayoutList size={18} />大纲</button>
        {onOpenAi && <button type="button" onClick={() => { setActionsOpen(false); onOpenAi(); }}><PanelRightOpen size={18} />AI 工具</button>}
        <button type="button" disabled={!editorReady || mode === "preview" || attachments.busy || editing.busy} onClick={() => { setActionsOpen(false); imageInput.current?.click(); }}><Upload size={18} />插入图片</button>
        <button type="button" disabled={!editing.dirty || editing.busy} onClick={() => { setActionsOpen(false); editing.onDiscard(); }}><Eye size={18} />放弃修改</button>
        <button type="button" aria-label="备份与恢复" disabled={!date || editing.busy} onClick={() => { setActionsOpen(false); editing.onBackups(); }}><DatabaseBackup size={18} />备份</button>
        <button className="danger" type="button" aria-label="删除当前日块" disabled={!day?.exists || editing.busy} onClick={() => { setActionsOpen(false); editing.onDelete(); }}><Trash2 size={18} />删除日块</button>
      </div>
      <div className="mobile-sheet-section"><span>导出</span><div>
        {exportScopes.map(item => <button key={item.scope} type="button" aria-label={`导出${item.label}`} disabled={!active || exporting.busy || item.disabled} onClick={() => { setActionsOpen(false); void exporting.run(item.scope); }}>{item.scope === "file" ? "源文件" : item.label}</button>)}
      </div></div>
    </section></div>}
    {linkSelection && active && createPortal(<InternalLinkDialog initialAlias={linkSelection.alias} onClose={() => setLinkSelection(null)} onInsert={markdown => {
      if (editorView.current === linkSelection.view && linkSelection.view.state.doc.toString() === linkSelection.document) insertAtRange(linkSelection.view, linkSelection.range, markdown);
      setLinkSelection(null);
    }} />, document.body)}
  </>;
}

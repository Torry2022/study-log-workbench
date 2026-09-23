"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, FileText, Highlighter, Lightbulb, LogOut, Menu, MessageSquareText, Monitor, Moon, MoreHorizontal, PanelRightOpen, Plus, Search, Star, Sun, Wand2, X } from "lucide-react";
import type { WorkspaceView } from "@/hooks/use-log-workspace";
import type { DaySummary, MonthSummary } from "@/lib/types";
import { withBasePath } from "@/lib/base-path";
import { useMobileViewport } from "@/hooks/use-mobile-viewport";
import { DateJump } from "./DateJump";
import { SidebarFilterPopover } from "./SidebarFilterPopover";
import { SidebarFilterHeading } from "./SidebarFilterHeading";
import { isValidLogDate, isFutureLogDate, todayInShanghai } from "@/lib/study-date";
import { SearchBox, type SearchSelection } from "./SearchBox";
import { lockBodyScroll } from "@/hooks/use-dialog-exit";
import "@/app/workspace.css";
import "@/app/writing-inspector.css";

export interface WorkspaceChromeProps {
  active: boolean;
  view: WorkspaceView;
  onView: (view: WorkspaceView) => Promise<boolean>;
  moduleNavigation: (onNavigate: () => void, filtersOnly?: boolean) => ReactNode;
  moduleSidebar?: { title: ReactNode; label: string; icon: ReactNode; filtered: boolean; onReset: () => void; railActionBefore?: ReactNode; railAction?: ReactNode };
  ragNavigation?: (controls: { collapsed: boolean; visible: boolean; onCollapse: () => void; onExpand: () => void; onNavigate: () => void }) => ReactNode;
  inspector?: ReactNode;
  openAiRequest?: number;
  inspectorTab: "writing" | "highlighting";
  onInspectorTab: (tab: "writing" | "highlighting") => void;
  months: MonthSummary[];
  days: DaySummary[];
  selectedMonth: string;
  selectedDate: string;
  dayQuery: string;
  onDayQueryChange: (value: string) => void;
  selectedLogLabel?: string;
  loading: boolean;
  error: string;
  theme: "light" | "dark";
  themePreference?: "system" | "light" | "dark";
  readingMode?: boolean;
  onMonth: (month: string) => void;
  onDate: (date: string, heading?: string, headingIndex?: number) => void | Promise<boolean>;
  onNewDate: (date: string) => void;
  onTheme: (theme: "system" | "light" | "dark") => void;
  onLogout: () => void;
  onRetry: () => void;
  onSearchSelect: (result: SearchSelection) => Promise<boolean>;
  onSearchChange: () => void;
  children: ReactNode;
}

const SIDEBAR_VIEWS: WorkspaceView[] = ["log", "notes", "favorites", "stats", "qa"];
const sidebarCookie = (view: WorkspaceView) => `study-log-sidebar-${view}`;
const themes = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "日间模式", Icon: Sun },
  { value: "dark", label: "夜间模式", Icon: Moon }
] as const;

/** Presentation and navigation only; authentication and document state belong to Workspace. */
export function WorkspaceChrome({ active, view, onView, moduleNavigation, moduleSidebar, ragNavigation, inspector, openAiRequest = 0, inspectorTab, onInspectorTab, months, days, selectedMonth, selectedDate, dayQuery: query, onDayQueryChange: setQuery, selectedLogLabel, loading, error,
  theme, themePreference = "system", readingMode = false, onMonth, onDate, onNewDate, onTheme, onLogout, onRetry, onSearchSelect, onSearchChange, children }: WorkspaceChromeProps) {
  const [compact, setCompact] = useState(false);
  const [sidebarPreferences, setSidebarPreferences] = useState<Partial<Record<WorkspaceView, boolean>>>({});
  const collapsed = sidebarPreferences[view] ?? false;
  const setCollapsed = (value: boolean) => setSidebarPreferences(current => ({ ...current, [view]: value }));
  const [panel, setPanel] = useState<"navigation" | "account" | "search" | "writing" | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(380);
  const writingPanel = useRef<HTMLElement>(null);
  const lastAiRequest = useRef(0);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const hasInspector = Boolean(inspector) && view === "log" && !readingMode;
  const [monthsExpanded, setMonthsExpanded] = useState(false);
  const [customDate, setCustomDate] = useState(todayInShanghai());
  const [themeOpen, setThemeOpen] = useState(false);
  const [dateJumpRequest, setDateJumpRequest] = useState(0);
  const dateJumpSequence = useRef(0);
  const sidebar = useRef<HTMLElement>(null);
  const account = useRef<HTMLElement>(null);
  const globalSearch = useRef<HTMLDivElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);
  const themeMenu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const monthHeading = useRef<HTMLDivElement>(null);
  const dateSearch = useRef<HTMLInputElement>(null);
  const keyboardOpen = useMobileViewport(compact);
  const drawerOpen = compact && panel !== null;
  const effectiveCollapsed = !compact && collapsed;
  const writingExpanded = compact ? panel === "writing" : !inspectorCollapsed;
  const filteredDays = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? days.filter(day => `${day.date} ${day.headings.join(" ")}`.toLocaleLowerCase().includes(needle)) : days;
  }, [days, query]);

  useEffect(() => {
    const cookies = document.cookie.split("; ");
    setSidebarPreferences(Object.fromEntries(SIDEBAR_VIEWS.map(item => [item, cookies.includes(`${sidebarCookie(item)}=collapsed`)])));
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => { setCompact(media.matches); setPanel(null); setThemeOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active || view !== "log" || !hasInspector || openAiRequest <= lastAiRequest.current) return;
    lastAiRequest.current = openAiRequest;
    if (compact) openPanel("writing");
    else setInspectorCollapsed(false);
  }, [active, view, hasInspector, openAiRequest, compact]);

  useEffect(() => { if (readingMode) { setPanel(null); setThemeOpen(false); } }, [readingMode]);
  useEffect(() => { if (!hasInspector) setPanel(current => current === "writing" ? null : current); }, [hasInspector]);
  useEffect(() => () => { resizeCleanup.current?.(); }, []);
  useEffect(() => {
    if (!active) { setPanel(null); setThemeOpen(false); }
    if (!active || (compact && panel !== "navigation")) setDateJumpRequest(0);
  }, [active, compact, panel]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!active || view !== "log" || readingMode || !event.ctrlKey || event.altKey || event.key.toLowerCase() !== "g") return;
      event.preventDefault();
      if (compact && panel !== "navigation") openPanel("navigation");
      else if (!compact && collapsed) { setCollapsed(false); document.cookie = `${sidebarCookie(view)}=expanded; Path=/study-log; Max-Age=31536000; SameSite=Lax`; }
      setDateJumpRequest(++dateJumpSequence.current);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, view, compact, collapsed, panel, readingMode]);

  function changeCollapsed(value: boolean, target?: "months" | "dates") {
    setDateJumpRequest(0);
    setCollapsed(value);
    document.cookie = `${sidebarCookie(view)}=${value ? "collapsed" : "expanded"}; Path=/study-log; Max-Age=31536000; SameSite=Lax`;
    requestAnimationFrame(() => {
      if (value) sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else if (target === "dates") dateSearch.current?.focus();
      else monthHeading.current?.focus();
    });
  }

  function openPanel(value: "navigation" | "account" | "search" | "writing") {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(value);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const dialog = panel === "navigation" ? sidebar.current : panel === "search" ? globalSearch.current : panel === "writing" ? writingPanel.current : account.current;
    const unlockScroll = lockBodyScroll();
    const frame = requestAnimationFrame(() => dialog?.querySelector<HTMLElement>(panel === "search" ? "input" : "button")?.focus());
    const keydown = (event: KeyboardEvent) => {
      // A leave-confirmation above this drawer owns Escape and keyboard focus.
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.key === "Escape") { event.preventDefault(); setPanel(null); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
        .filter(item => item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame); unlockScroll();
      document.removeEventListener("keydown", keydown);
      const target = returnFocus.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
    };
  }, [drawerOpen, panel]);

  useEffect(() => {
    if (!themeOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setThemeOpen(false); themeButton.current?.focus(); }
    };
    const outside = (event: PointerEvent) => {
      if (!themeMenu.current?.contains(event.target as Node)) setThemeOpen(false);
    };
    document.addEventListener("keydown", keydown); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", outside); };
  }, [themeOpen]);

  function chooseTheme(value: "system" | "light" | "dark") {
    onTheme(value); setThemeOpen(false);
    if (!compact) themeButton.current?.focus();
  }

  const switchView = async (next: WorkspaceView) => { if (await onView(next)) setPanel(null); };
  const viewLabel = { log: "学习日志", notes: "随记", favorites: "收藏中心", stats: "学习统计", qa: "知识问答" }[view];
  const navigationLabel = { log: "打开日志导航", notes: "打开随记筛选", favorites: "打开收藏筛选", stats: "打开统计导航", qa: "打开问答历史" }[view];
  const ViewIcon = { log: FileText, notes: Lightbulb, favorites: Star, stats: BarChart3, qa: MessageSquareText }[view];
  async function selectSidebarDate(date: string, heading?: string, headingIndex?: number) {
    const accepted = await onDate(date, heading, headingIndex);
    if (accepted === false) return false;
    setQuery("");
    if (compact) setPanel(null);
    return true;
  }
  const logDateCreation = <>
<button className="button secondary full" type="button" onClick={() => { onNewDate(todayInShanghai()); if (compact) setPanel(null); }}><Plus size={15} />今天</button>
            <form className="date-create" onSubmit={event => { event.preventDefault(); if (!isValidLogDate(customDate) || isFutureLogDate(customDate)) return; onNewDate(customDate); if (compact) setPanel(null); }}>
              <input type="date" value={customDate} max={todayInShanghai()} onChange={event => setCustomDate(event.target.value)} aria-label="新建指定日期" />
              <button type="submit" disabled={!isValidLogDate(customDate) || isFutureLogDate(customDate)}><Plus size={14} />新建</button>
            </form>
  </>;

  return <main className={`app-shell view-${view} public-reading-shell${readingMode ? " reading-mode" : ""}${keyboardOpen ? " mobile-keyboard-open" : ""}`}>
    <header className="topbar" inert={drawerOpen && panel !== "search"}>
      <div className="mobile-topbar">
        <button className="mobile-topbar-button" type="button" onClick={() => openPanel("navigation")} aria-label={navigationLabel} aria-expanded={panel === "navigation"}><Menu size={20} /></button>
        <div className="mobile-topbar-title"><strong>{viewLabel}</strong></div>
        <div className="mobile-topbar-actions"><button className="mobile-topbar-button" type="button" onClick={() => openPanel("search")} aria-label="全局搜索" hidden={view !== "log" && view !== "qa"}><Search size={19} /></button><button className="mobile-topbar-button" type="button" onClick={() => openPanel("account")} aria-label="更多设置"><MoreHorizontal size={20} /></button></div>
      </div>
      <div className="brand">
        <span className="brand-mark theme-logo" aria-hidden="true"><img className="theme-logo-light" src={withBasePath("/app-logo-light.svg")} alt="" /><img className="theme-logo-dark" src={withBasePath("/app-logo-dark.svg")} alt="" /></span>
        <div><strong>学习日志工作台</strong><span>{view === "log" ? selectedLogLabel || (selectedDate ? days.find(day => day.date === selectedDate)?.headings.join(" / ") || "未命名日志" : "未选择日志") : viewLabel}</span></div>
      </div>
      <div ref={globalSearch} className={`workspace-global-search${panel === "search" ? " mobile-search-active" : ""}`} inert={compact && panel !== "search"} role={compact && panel === "search" ? "dialog" : undefined} aria-modal={compact && panel === "search" ? true : undefined} aria-label={compact && panel === "search" ? "搜索全部日志" : undefined}>
        <div className="mobile-search-header"><button type="button" aria-label="关闭搜索" onClick={() => setPanel(null)}><ChevronLeft size={20} /></button><strong>搜索全部日志</strong></div>
        <SearchBox active={active && (!compact || panel === "search")} onQueryChange={onSearchChange} onSelect={async result => { const accepted = await onSearchSelect(result); if (accepted && compact) setPanel(null); return accepted; }} />
      </div>
      <div className="topbar-actions">
        <button className={`button secondary app-nav-link${view === "notes" ? " active" : ""}`} type="button" onClick={() => void switchView("notes")}><Lightbulb size={16} />随记</button>
        <button className={`button secondary app-nav-link${view === "favorites" ? " active" : ""}`} type="button" onClick={() => void switchView("favorites")}><Star size={16} />收藏</button>
        <button className={`button secondary app-nav-link${view === "qa" ? " active" : ""}`} type="button" onClick={() => void switchView("qa")}><MessageSquareText size={16} />问答</button>
        <button className={`button secondary app-nav-link${view === "stats" ? " active" : ""}`} type="button" onClick={() => void switchView("stats")}><BarChart3 size={16} />统计</button>
        <div className="theme-menu" ref={themeMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setThemeOpen(false); }}>
          <button className="button icon-only" ref={themeButton} type="button" onClick={() => setThemeOpen(value => !value)} aria-label="切换主题模式" aria-expanded={themeOpen} title="切换主题模式">{themePreference === "system" ? <Monitor size={17} /> : theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</button>
          {themeOpen && <div className="theme-popover" role="group" aria-label="主题模式">{themes.map(({ value, label, Icon }) => <button key={value} className={themePreference === value ? "active" : ""} type="button" aria-pressed={themePreference === value} onClick={() => chooseTheme(value)}><Icon size={15} />{label}{value === "system" && <small>{theme === "dark" ? "夜间" : "日间"}</small>}</button>)}</div>}
        </div>
        <button className="button ghost" type="button" onClick={onLogout}><LogOut size={16} />退出</button>
      </div>
    </header>
    <section className={`workspace ${hasInspector ? "with-writing" : "without-inspector"}${writingExpanded ? " writing-expanded" : ""}${readingMode ? " reading-mode-workspace" : ""}${effectiveCollapsed ? " sidebar-collapsed" : ""}`} style={{ "--inspector-width": `${writingExpanded ? inspectorWidth : 52}px` } as CSSProperties}>
      <aside ref={sidebar} className={`sidebar${view === "qa" ? " qa-sidebar" : ""}${effectiveCollapsed ? " collapsed" : ""}${panel === "navigation" ? " mobile-open" : ""}`}
        inert={compact && panel !== "navigation"} role={compact ? "dialog" : undefined} aria-modal={compact && panel === "navigation" ? true : undefined} aria-label={`${viewLabel}导航`}>
        <div className="mobile-drawer-header"><div><strong>{viewLabel}</strong><span>{{ log: "按月份和日期浏览", notes: "按年份和标签筛选", favorites: "按分组和日志月份筛选", qa: "历史会话", stats: "切换月份与管理分类" }[view]}</span></div><button className="mobile-drawer-close" type="button" onClick={() => setPanel(null)} aria-label="关闭左侧导航"><X size={19} /></button></div>
        {view === "qa" && ragNavigation ? ragNavigation({ collapsed: effectiveCollapsed, visible: !compact || panel === "navigation", onCollapse: () => changeCollapsed(true), onExpand: () => changeCollapsed(false), onNavigate: () => setPanel(null) }) : effectiveCollapsed ? <div className="sidebar-rail">
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false)} aria-label="展开左侧栏" title="展开左侧栏"><ChevronRight size={18} /></button>
          {view !== "log" ? moduleSidebar ? <>{moduleSidebar.railActionBefore}<SidebarFilterPopover key={view} active={active} label={moduleSidebar.label} icon={moduleSidebar.icon} filtered={moduleSidebar.filtered} onReset={moduleSidebar.onReset}>{moduleNavigation(() => {}, true)}</SidebarFilterPopover>{moduleSidebar.railAction}</> : <button className="sidebar-rail-button" onClick={() => changeCollapsed(false)} aria-label={`展开${viewLabel}筛选`} title={`${viewLabel}筛选`}><ViewIcon size={17} /></button> : <>
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false, "months")} aria-label="展开月份列表" title="月份"><CalendarDays size={17} /></button>
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false, "dates")} aria-label="展开日期列表" title="日期"><FileText size={17} /></button>
          <button className="sidebar-rail-button" onClick={() => onNewDate(todayInShanghai())} aria-label="新建今日日志" title="新建今日日志"><Plus size={17} /></button></>}
        </div> : view !== "log" ? <>{moduleSidebar ? <SidebarFilterHeading title={moduleSidebar.title} filtered={moduleSidebar.filtered} onReset={moduleSidebar.onReset} onCollapse={() => changeCollapsed(true)} /> : <div className="sidebar-heading"><div className="section-title inline"><ViewIcon size={15} />{viewLabel}</div><button className="sidebar-collapse-button" onClick={() => changeCollapsed(true)} aria-label="折叠左侧栏"><ChevronLeft size={16} /></button></div>}{moduleNavigation(() => setPanel(null))}</> : <>
          {compact && <div className="sidebar-section mobile-log-create">{logDateCreation}</div>}
          <div className="sidebar-section" data-log-section="months">
            <div className="sidebar-heading" ref={monthHeading} tabIndex={-1}><div className="section-title inline"><CalendarDays size={15} /><span>月份</span></div><button className="sidebar-collapse-button" onClick={() => changeCollapsed(true)} aria-label="折叠左侧栏" title="折叠左侧栏"><ChevronLeft size={16} /></button></div>
            <div className="month-list">{(compact && !monthsExpanded ? months.slice(0, 6) : months).map(month => <button key={month.id} type="button" className={`nav-item${month.id === selectedMonth ? " active" : ""}`} aria-current={month.id === selectedMonth ? "true" : undefined} onClick={() => { setQuery(""); onMonth(month.id); }}><span>{month.label}</span><small>{month.dayCount}</small></button>)}</div>
            {compact && months.length > 6 && <button className="button secondary full" type="button" aria-expanded={monthsExpanded} onClick={() => setMonthsExpanded(value => !value)}>{monthsExpanded ? "收起月份" : `展开其余 ${months.length - 6} 个月份`}</button>}
          </div>
          <div className="sidebar-section grow" data-log-section="dates">
            <div className="section-title date-section-title"><span className="section-title-left"><FileText size={15} />日期</span><DateJump months={months} selectedDate={selectedDate} active={active && (!compact || panel === "navigation")} openRequest={dateJumpRequest} onDate={date => selectSidebarDate(date)} /></div>
            {!compact && logDateCreation}
            <div className="sidebar-search"><Search size={14} /><input ref={dateSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="按标签定位日期" aria-label="按日期标签搜索日期" />{query && <button className="sidebar-search-clear" type="button" onClick={() => { setQuery(""); dateSearch.current?.focus(); }} aria-label="清空日期搜索"><X size={13} /></button>}</div>
            <div className="day-list" aria-busy={loading}>
              {loading && <div className="day-empty" role="status">正在读取日志目录…</div>}
              {error && <div className="day-empty" role="alert">{error}<button className="button secondary full" type="button" onClick={onRetry}>重试</button></div>}
              {!loading && !error && !filteredDays.length && <div className="day-empty">{query ? "未找到匹配标签的日期" : months.length ? "本月暂无日志" : "暂无学习日志"}</div>}
              {!loading && !error && filteredDays.map(day => <div key={day.date} className={`day-item${day.date === selectedDate ? " active" : ""}`} onClick={() => void selectSidebarDate(day.date)}>
                <button className="day-item-open" type="button" aria-current={day.date === selectedDate ? "date" : undefined} onClick={event => { event.stopPropagation(); void selectSidebarDate(day.date); }}>
                  <span className="day-date">{query.trim() ? day.date : day.date.slice(5)}</span><span className="sr-only">打开该日块</span>
                </button>
                <div className="day-tags">{day.headings.length ? day.headings.map((heading, index) => <button type="button" className="day-tag interactive" key={`${index}:${heading}`} title={`定位到“${heading}”`} onClick={event => { event.stopPropagation(); void selectSidebarDate(day.date, heading, index); }}>{heading}</button>) : <span className="day-tag muted">未命名</span>}</div>
              </div>)}
            </div>
          </div>
        </>}
      </aside>
      <section className="reader reader-preview" inert={drawerOpen}>{children}</section>
      {hasInspector && <aside ref={writingPanel} className={`writing-inspector${writingExpanded ? " expanded" : " collapsed"}${panel === "writing" ? " mobile-open" : ""}`} inert={compact && panel !== "writing"} role={compact ? "dialog" : undefined} aria-modal={compact && panel === "writing" ? true : undefined} aria-label="AI 工具">
        {!compact && !writingExpanded && <div className="inspector-rail"><button className="rail-button" type="button" aria-label="展开右侧栏" title="展开右侧栏" onClick={() => setInspectorCollapsed(false)}><ChevronLeft size={18} /></button><button className={`rail-button${inspectorTab === "writing" ? " active" : ""}`} type="button" aria-label="AI生成" title="AI生成" onClick={() => { onInspectorTab("writing"); setInspectorCollapsed(false); }}><Wand2 size={17} /></button><button className={`rail-button${inspectorTab === "highlighting" ? " active" : ""}`} type="button" aria-label="重点标注" title="重点标注" onClick={() => { onInspectorTab("highlighting"); setInspectorCollapsed(false); }}><Highlighter size={17} /></button></div>}
        <div className="writing-inspector-content" hidden={!writingExpanded}>
          <div className="writing-inspector-heading"><div className="inspector-tabs" role="group" aria-label="AI 工具类型"><button type="button" className={inspectorTab === "writing" ? "active" : ""} aria-pressed={inspectorTab === "writing"} onClick={() => onInspectorTab("writing")}><Wand2 size={16} />AI生成</button><button type="button" className={inspectorTab === "highlighting" ? "active" : ""} aria-pressed={inspectorTab === "highlighting"} onClick={() => onInspectorTab("highlighting")}><Highlighter size={16} />重点标注</button></div><button className="collapse-button" type="button" aria-label={compact ? "关闭 AI 工具" : "折叠右侧栏"} onClick={() => compact ? setPanel(null) : setInspectorCollapsed(true)}>{compact ? <X size={19} /> : <ChevronRight size={16} />}</button></div>
          {inspector}
        </div>
        {!compact && writingExpanded && <div className="inspector-resizer" role="separator" tabIndex={0} aria-label="调整右侧栏宽度" aria-orientation="vertical" aria-valuenow={inspectorWidth} aria-valuemin={320} aria-valuemax={720}
          onKeyDown={event => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); setInspectorWidth(value => Math.max(320, Math.min(Math.min(720, Math.max(360, innerWidth - 560)), value + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 32 : 16)))); }}
          onPointerDown={event => { event.preventDefault(); resizeCleanup.current?.(); const start = event.clientX, width = inspectorWidth;
            const move = (next: PointerEvent) => setInspectorWidth(Math.max(320, Math.min(Math.min(720, Math.max(360, innerWidth - 560)), width + start - next.clientX)));
            const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); resizeCleanup.current = null; };
            resizeCleanup.current = finish; window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
          }} />}
      </aside>}
    </section>
    <nav className="mobile-bottom-nav" aria-label="主要功能" inert={drawerOpen}>
      <button className={view === "log" ? "active" : ""} type="button" onClick={() => void switchView("log")}><FileText size={20} /><span>日志</span></button>
      <button className={view === "notes" ? "active" : ""} type="button" onClick={() => void switchView("notes")}><Lightbulb size={20} /><span>随记</span></button>
      <button className={view === "favorites" ? "active" : ""} type="button" onClick={() => void switchView("favorites")}><Star size={20} /><span>收藏</span></button>
      <button className={view === "qa" ? "active" : ""} type="button" onClick={() => void switchView("qa")}><MessageSquareText size={20} /><span>问答</span></button>
      <button className={view === "stats" ? "active" : ""} type="button" onClick={() => void switchView("stats")}><BarChart3 size={20} /><span>统计</span></button>
    </nav>
    {compact && (panel === "navigation" || panel === "writing") && <div className="mobile-overlay-backdrop" aria-hidden="true" onClick={() => setPanel(null)} />}
    {compact && panel === "account" && <div className="mobile-sheet-backdrop" onClick={() => setPanel(null)}><section ref={account} className="mobile-action-sheet mobile-account-sheet" role="dialog" aria-modal="true" aria-label="应用设置" onClick={event => event.stopPropagation()}>
      <div className="mobile-sheet-header"><strong>应用设置</strong><button type="button" onClick={() => setPanel(null)} aria-label="关闭应用设置"><X size={18} /></button></div>
      <div className="mobile-theme-options" role="group" aria-label="主题模式">{themes.map(({ value, label, Icon }) => <button key={value} className={themePreference === value ? "active" : ""} type="button" aria-pressed={themePreference === value} onClick={() => chooseTheme(value)}><Icon size={18} />{label.replace("模式", "")}</button>)}</div>
      {hasInspector && <button className="button secondary full" type="button" onClick={() => openPanel("writing")}><PanelRightOpen size={18} />AI 工具</button>}
      <button className="mobile-logout" type="button" onClick={() => { setPanel(null); onLogout(); }}><LogOut size={18} />退出登录</button>
    </section></div>}
  </main>;
}

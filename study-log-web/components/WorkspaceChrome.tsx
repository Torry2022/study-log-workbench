"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, LogOut, Menu, Monitor, Moon, MoreHorizontal, Search, Sun, X } from "lucide-react";
import type { DaySummary, MonthSummary } from "@/lib/types";
import { withBasePath } from "@/lib/base-path";
import { useMobileViewport } from "@/hooks/use-mobile-viewport";
import { DateJump } from "./DateJump";
import "@/app/workspace.css";

export interface WorkspaceChromeProps {
  active: boolean;
  months: MonthSummary[];
  days: DaySummary[];
  selectedMonth: string;
  selectedDate: string;
  loading: boolean;
  error: string;
  theme: "light" | "dark";
  themePreference?: "system" | "light" | "dark";
  readingMode?: boolean;
  onMonth: (month: string) => void;
  onDate: (date: string) => void;
  onTheme: (theme: "system" | "light" | "dark") => void;
  onLogout: () => void;
  onRetry: () => void;
  children: ReactNode;
}

const SIDEBAR_COOKIE = "study-log-sidebar-log";
const themes = [
  { value: "system", label: "跟随系统", Icon: Monitor },
  { value: "light", label: "日间模式", Icon: Sun },
  { value: "dark", label: "夜间模式", Icon: Moon }
] as const;

/** Presentation and navigation only; authentication and document state belong to Workspace. */
export function WorkspaceChrome({ active, months, days, selectedMonth, selectedDate, loading, error,
  theme, themePreference = "system", readingMode = false, onMonth, onDate, onTheme, onLogout, onRetry, children }: WorkspaceChromeProps) {
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<"navigation" | "account" | null>(null);
  const [monthsExpanded, setMonthsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [themeOpen, setThemeOpen] = useState(false);
  const [dateJumpRequest, setDateJumpRequest] = useState(0);
  const dateJumpSequence = useRef(0);
  const sidebar = useRef<HTMLElement>(null);
  const account = useRef<HTMLElement>(null);
  const themeButton = useRef<HTMLButtonElement>(null);
  const themeMenu = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const monthHeading = useRef<HTMLDivElement>(null);
  const dateSearch = useRef<HTMLInputElement>(null);
  const keyboardOpen = useMobileViewport(compact);
  const drawerOpen = compact && panel !== null;
  const effectiveCollapsed = !compact && collapsed;
  const filteredDays = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? days.filter(day => `${day.date} ${day.headings.join(" ")}`.toLocaleLowerCase().includes(needle)) : days;
  }, [days, query]);

  useEffect(() => {
    setCollapsed(document.cookie.split("; ").some(item => item === `${SIDEBAR_COOKIE}=collapsed`));
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => { setCompact(media.matches); setPanel(null); setThemeOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => { if (readingMode) { setPanel(null); setThemeOpen(false); } }, [readingMode]);
  useEffect(() => {
    if (!active) { setPanel(null); setThemeOpen(false); }
    if (!active || (compact && panel !== "navigation")) setDateJumpRequest(0);
  }, [active, compact, panel]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!active || readingMode || !event.ctrlKey || event.altKey || event.key.toLowerCase() !== "g") return;
      event.preventDefault();
      if (compact && panel !== "navigation") openPanel("navigation");
      else if (!compact && collapsed) { setCollapsed(false); document.cookie = `${SIDEBAR_COOKIE}=expanded; Path=/study-log; Max-Age=31536000; SameSite=Lax`; }
      setDateJumpRequest(++dateJumpSequence.current);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, compact, collapsed, panel, readingMode]);

  function changeCollapsed(value: boolean, target?: "months" | "dates") {
    setDateJumpRequest(0);
    setCollapsed(value);
    document.cookie = `${SIDEBAR_COOKIE}=${value ? "collapsed" : "expanded"}; Path=/study-log; Max-Age=31536000; SameSite=Lax`;
    requestAnimationFrame(() => {
      if (value) sidebar.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else if (target === "dates") dateSearch.current?.focus();
      else monthHeading.current?.focus();
    });
  }

  function openPanel(value: "navigation" | "account") {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(value);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    const dialog = panel === "navigation" ? sidebar.current : account.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => dialog?.querySelector<HTMLButtonElement>("button")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPanel(null); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'))
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
      cancelAnimationFrame(frame); document.body.style.overflow = previousOverflow;
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

  return <main className={`app-shell view-log public-reading-shell${readingMode ? " reading-mode" : ""}${keyboardOpen ? " mobile-keyboard-open" : ""}`}>
    <header className="topbar" inert={drawerOpen}>
      <div className="mobile-topbar">
        <button className="mobile-topbar-button" type="button" onClick={() => openPanel("navigation")} aria-label="打开日志导航" aria-expanded={panel === "navigation"}><Menu size={20} /></button>
        <div className="mobile-topbar-title"><strong>学习日志</strong></div>
        <div className="mobile-topbar-actions"><button className="mobile-topbar-button" type="button" onClick={() => openPanel("account")} aria-label="更多设置"><MoreHorizontal size={20} /></button></div>
      </div>
      <div className="brand">
        <span className="brand-mark theme-logo" aria-hidden="true"><img className="theme-logo-light" src={withBasePath("/app-logo-light.svg")} alt="" /><img className="theme-logo-dark" src={withBasePath("/app-logo-dark.svg")} alt="" /></span>
        <div><strong>学习日志工作台</strong><span>{selectedDate || "记录与回顾每天的技术学习"}</span></div>
      </div>
      <div className="topbar-actions">
        <div className="theme-menu" ref={themeMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setThemeOpen(false); }}>
          <button className="button icon-only" ref={themeButton} type="button" onClick={() => setThemeOpen(value => !value)} aria-label="切换主题模式" aria-expanded={themeOpen} title="切换主题模式">{themePreference === "system" ? <Monitor size={17} /> : theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</button>
          {themeOpen && <div className="theme-popover" role="group" aria-label="主题模式">{themes.map(({ value, label, Icon }) => <button key={value} className={themePreference === value ? "active" : ""} type="button" aria-pressed={themePreference === value} onClick={() => chooseTheme(value)}><Icon size={15} />{label}{value === "system" && <small>{theme === "dark" ? "夜间" : "日间"}</small>}</button>)}</div>}
        </div>
        <button className="button ghost" type="button" onClick={onLogout}><LogOut size={16} />退出</button>
      </div>
    </header>
    <section className={`workspace without-inspector${readingMode ? " reading-mode-workspace" : ""}${effectiveCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside ref={sidebar} className={`sidebar${effectiveCollapsed ? " collapsed" : ""}${panel === "navigation" ? " mobile-open" : ""}`}
        inert={compact && panel !== "navigation"} role={compact ? "dialog" : undefined} aria-modal={compact && panel === "navigation" ? true : undefined} aria-label="日志导航">
        <div className="mobile-drawer-header"><div><strong>学习日志</strong><span>按月份和日期浏览</span></div><button className="mobile-drawer-close" type="button" onClick={() => setPanel(null)} aria-label="关闭左侧导航"><X size={19} /></button></div>
        {effectiveCollapsed ? <div className="sidebar-rail">
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false)} aria-label="展开左侧栏" title="展开左侧栏"><ChevronRight size={18} /></button>
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false, "months")} aria-label="展开月份列表" title="月份"><CalendarDays size={17} /></button>
          <button className="sidebar-rail-button" onClick={() => changeCollapsed(false, "dates")} aria-label="展开日期列表" title="日期"><FileText size={17} /></button>
        </div> : <>
          <div className="sidebar-section" data-log-section="months">
            <div className="sidebar-heading" ref={monthHeading} tabIndex={-1}><div className="section-title inline"><CalendarDays size={15} /><span>月份</span></div><button className="sidebar-collapse-button" onClick={() => changeCollapsed(true)} aria-label="折叠左侧栏" title="折叠左侧栏"><ChevronLeft size={16} /></button></div>
            <div className="month-list">{(compact && !monthsExpanded ? months.slice(0, 6) : months).map(month => <button key={month.id} type="button" className={`nav-item${month.id === selectedMonth ? " active" : ""}`} aria-current={month.id === selectedMonth ? "true" : undefined} onClick={() => { setQuery(""); onMonth(month.id); }}><span>{month.label}</span><small>{month.dayCount}</small></button>)}</div>
            {compact && months.length > 6 && <button className="button secondary full" type="button" aria-expanded={monthsExpanded} onClick={() => setMonthsExpanded(value => !value)}>{monthsExpanded ? "收起月份" : `展开其余 ${months.length - 6} 个月份`}</button>}
          </div>
          <div className="sidebar-section grow" data-log-section="dates">
            <div className="section-title date-section-title"><span className="section-title-left"><FileText size={15} />日期</span><DateJump months={months} selectedDate={selectedDate} active={active && (!compact || panel === "navigation")} openRequest={dateJumpRequest} onDate={date => { onDate(date); if (compact) setPanel(null); }} /></div>
            <div className="sidebar-search"><Search size={14} /><input ref={dateSearch} value={query} onChange={event => setQuery(event.target.value)} placeholder="按标签定位日期" aria-label="按日期标签搜索日期" />{query && <button className="sidebar-search-clear" type="button" onClick={() => { setQuery(""); dateSearch.current?.focus(); }} aria-label="清空日期搜索"><X size={13} /></button>}</div>
            <div className="day-list" aria-busy={loading}>
              {loading && <div className="day-empty" role="status">正在读取日志目录…</div>}
              {error && <div className="day-empty" role="alert">{error}<button className="button secondary full" type="button" onClick={onRetry}>重试</button></div>}
              {!loading && !error && !filteredDays.length && <div className="day-empty">{query ? "未找到匹配标签的日期" : months.length ? "本月暂无日志" : "暂无学习日志"}</div>}
              {!loading && !error && filteredDays.map(day => <button key={day.date} type="button" className={`day-item${day.date === selectedDate ? " active" : ""}`} aria-current={day.date === selectedDate ? "date" : undefined} onClick={() => { onDate(day.date); if (compact) setPanel(null); }}><span className="day-date">{day.date}</span><span className="day-tags">{day.headings.length ? day.headings.map((heading, index) => <span className="day-tag" key={`${index}:${heading}`}>{heading}</span>) : <span className="day-tag muted">暂无小节标题</span>}</span></button>)}
            </div>
          </div>
        </>}
      </aside>
      <section className="reader reader-preview" inert={drawerOpen}>{children}</section>
    </section>
    {compact && panel === "navigation" && <div className="mobile-overlay-backdrop" aria-hidden="true" onClick={() => setPanel(null)} />}
    {compact && panel === "account" && <div className="mobile-sheet-backdrop" onClick={() => setPanel(null)}><section ref={account} className="mobile-action-sheet mobile-account-sheet" role="dialog" aria-modal="true" aria-label="应用设置" onClick={event => event.stopPropagation()}>
      <div className="mobile-sheet-header"><strong>应用设置</strong><button type="button" onClick={() => setPanel(null)} aria-label="关闭应用设置"><X size={18} /></button></div>
      <div className="mobile-theme-options" role="group" aria-label="主题模式">{themes.map(({ value, label, Icon }) => <button key={value} className={themePreference === value ? "active" : ""} type="button" aria-pressed={themePreference === value} onClick={() => chooseTheme(value)}><Icon size={18} />{label.replace("模式", "")}</button>)}</div>
      <button className="mobile-logout" type="button" onClick={() => { setPanel(null); onLogout(); }}><LogOut size={18} />退出登录</button>
    </section></div>}
  </main>;
}

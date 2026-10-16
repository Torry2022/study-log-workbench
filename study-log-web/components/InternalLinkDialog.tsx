"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, FileText, Link2, Search, TextCursorInput, X } from "lucide-react";
import { useDialogExit } from "@/hooks/use-dialog-exit";
import "@/app/internal-links.css";
import { buildInternalLinkMarkup } from "@/lib/internal-links";
import { requestJson } from "@/lib/client-http";
import type { InternalLinkCandidate } from "@/lib/internal-links";

export type InternalLinkDialogProps = {
  initialAlias?: string;
  onClose: () => void;
  onInsert: (markdown: string) => void;
};

function LinkState({ kind, title, onRetry }: { kind: "loading" | "error" | "empty"; title: string; onRetry?: () => void }) {
  return <div className={`workspace-state workspace-state-${kind} internal-link-state`} role={kind === "error" ? "alert" : "status"}>
    <div className="workspace-state-body"><span className="workspace-state-title">{title}</span>
      {onRetry && <div className="workspace-state-actions"><button type="button" className="button secondary" onClick={onRetry}>重试</button></div>}
    </div>
  </div>;
}

export function InternalLinkDialog({ initialAlias = "", onClose, onInsert }: InternalLinkDialogProps) {
  const [query, setQuery] = useState(initialAlias);
  const [date, setDate] = useState("");
  const [headingsOnly, setHeadingsOnly] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [searchRevision, setSearchRevision] = useState(0);
  const [resultsKey, setResultsKey] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const moreRequestRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const immediateSearchRef = useRef(false);
  const searchKey = JSON.stringify([query, date, headingsOnly, ignoreCase]);
  const [customAlias, setCustomAlias] = useState("");
  const [results, setResults] = useState<InternalLinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canChoose = !loading && !error && resultsKey === searchKey;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<"keyboard" | "pointer" | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestSequenceRef = useRef(0);
  const onCloseRef = useRef(onClose);
  const { backdropRef, requestExit } = useDialogExit<HTMLDivElement>(closeDialog);

  function closeDialog() { requestExit(onClose); }

  function chooseCandidate(candidate: InternalLinkCandidate) {
    if (!canChoose) return;
    const alias = initialAlias || customAlias;
    try {
      const markdown = buildInternalLinkMarkup(candidate, alias);
      setError("");
      requestExit(() => onInsert(markdown));
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "无法创建内部链接");
    }
  }

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body, root = document.documentElement;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const previousOverflow = body.style.overflow, previousScrollBehavior = root.style.scrollBehavior;
    body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestExit(() => onCloseRef.current());
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      window.cancelAnimationFrame(frame);
      body.style.overflow = previousOverflow;
      root.style.scrollBehavior = "auto";
      window.scrollTo(scrollX, scrollY);
      root.style.scrollBehavior = previousScrollBehavior;
      window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
    };
  }, [requestExit]);

  function searchNow() {
    immediateSearchRef.current = true;
    setSearchRevision(current => current + 1);
  }

  useEffect(() => {
    moreRequestRef.current?.abort();
    moreRequestRef.current = null;
    setLoadingMore(false);
    setMoreError("");
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    const delay = immediateSearchRef.current ? 0 : 160;
    immediateSearchRef.current = false;
    setLoading(true);
    setError("");
    setActiveIndex(null);
    setActiveSource(null);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ query, limit: "40", ignoreCase: String(ignoreCase), scope: headingsOnly ? "heading" : "all" });
        if (date) params.set("date", date);
        const response = await requestJson<{ results: InternalLinkCandidate[]; hasMore?: boolean }>(`/api/links?${params}`, { signal: controller.signal });
        if (controller.signal.aborted || requestSequenceRef.current !== sequence) return;
        if (listRef.current) listRef.current.scrollTop = 0;
        setResults(response.results);
        setResultsKey(searchKey);
        setHasMore(response.hasMore === true);
      } catch (requestError) {
        if (controller.signal.aborted || requestSequenceRef.current !== sequence) return;
        setError(requestError instanceof Error ? requestError.message : "读取链接目标失败");
      } finally {
        if (!controller.signal.aborted && requestSequenceRef.current === sequence) setLoading(false);
      }
    }, delay);
    return () => { window.clearTimeout(timer); controller.abort(); moreRequestRef.current?.abort(); };
  }, [query, date, headingsOnly, ignoreCase, searchKey, searchRevision]);

  async function loadMore() {
    if (!canChoose || !hasMore || moreRequestRef.current) return;
    const controller = new AbortController();
    moreRequestRef.current = controller;
    const sequence = requestSequenceRef.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const params = new URLSearchParams({ query, limit: "40", offset: String(results.length), ignoreCase: String(ignoreCase), scope: headingsOnly ? "heading" : "all" });
      if (date) params.set("date", date);
      const response = await requestJson<{ results: InternalLinkCandidate[]; hasMore?: boolean }>(`/api/links?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || requestSequenceRef.current !== sequence) return;
      setResults(current => [...current, ...response.results]);
      setHasMore(response.hasMore === true);
    } catch (requestError) {
      if (!controller.signal.aborted && requestSequenceRef.current === sequence) setMoreError(requestError instanceof Error ? requestError.message : "读取更多目标失败");
    } finally {
      if (moreRequestRef.current === controller) {
        moreRequestRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (!canChoose || !hasMore || loadingMore || moreError || !sentinelRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { root: listRef.current, rootMargin: "120px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [canChoose, hasMore, loadingMore, moreError, results.length, searchKey]);

  useEffect(() => {
    if (activeSource === "keyboard" && activeIndex !== null) listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, activeSource]);

  return <div ref={backdropRef} className="internal-link-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
    <section className="internal-link-dialog" role="dialog" aria-modal="true" aria-labelledby="internal-link-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="internal-link-dialog-header">
        <div><span aria-hidden="true"><Link2 size={19} /></span><div><h2 id="internal-link-dialog-title">插入内部链接</h2><p>选择日志或小节，自动生成跳转语法。</p></div></div>
        <button type="button" onClick={closeDialog} aria-label="关闭内部链接选择器"><X size={18} /></button>
      </header>
      <div className="internal-link-dialog-controls">
        <div className="internal-link-search">
          <div className="internal-link-search-field">
            <Search size={16} aria-hidden="true" />
            <input ref={searchInputRef} value={query} aria-label="搜索链接目标" role="combobox" aria-autocomplete="list" aria-expanded="true"
              aria-controls="internal-link-results" aria-activedescendant={activeIndex !== null && results[activeIndex] ? `internal-link-result-${activeIndex}` : undefined}
              placeholder={headingsOnly ? "搜索小节标题" : "搜索日期、标题或正文"} onChange={event => setQuery(event.target.value)}
              onFocus={() => { setActiveIndex(null); setActiveSource(null); }} onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && canChoose && results.length) {
                  event.preventDefault();
                  setActiveIndex(current => event.key === "ArrowDown" ? Math.min((current ?? -1) + 1, results.length - 1) : Math.max((current ?? 0) - 1, 0));
                  setActiveSource("keyboard");
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (canChoose && activeIndex !== null && results[activeIndex]) chooseCandidate(results[activeIndex]); else searchNow();
                }
              }} />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="清空目标搜索"><X size={15} /></button>}
          </div>
          {date && <div className="internal-link-date-filter"><CalendarDays size={14} aria-hidden="true" /><span>{date}</span>
            <button type="button" onClick={() => { immediateSearchRef.current = true; setDate(""); }} aria-label="清除日期筛选"><X size={15} /></button></div>}
          <div className="internal-link-search-tools">
            <button type="button" className={`search-heading-toggle${headingsOnly ? " active" : ""}`} aria-label="仅搜索小节标题" title="仅搜索小节标题" aria-pressed={headingsOnly}
              onClick={() => { immediateSearchRef.current = true; setHeadingsOnly(current => !current); }}>H3</button>
            <button type="button" className={`search-case-toggle${ignoreCase ? "" : " active"}`} aria-label="区分大小写" title="区分大小写" aria-pressed={!ignoreCase}
              onClick={() => { immediateSearchRef.current = true; setIgnoreCase(current => !current); }}>Aa</button>
            <label className={`internal-link-date-toggle${date ? " active" : ""}`} title="筛选日志日期"><CalendarDays size={16} aria-hidden="true" />
              <input type="date" aria-label="筛选日志日期" value={date} onChange={event => { immediateSearchRef.current = true; setDate(event.target.value); }} /></label>
            <button type="button" className="search-submit" aria-label="查询链接目标" title="查询" onClick={searchNow}><Search size={16} /></button>
          </div>
        </div>
        {!initialAlias && <label className="internal-link-alias-row"><span className="internal-link-alias"><TextCursorInput size={16} aria-hidden="true" />
          <input value={customAlias} onChange={event => setCustomAlias(event.target.value)} placeholder="自定义链接文字（留空使用所选日志或小节的标题）" aria-label="自定义显示文字" />
          {customAlias && <button type="button" onClick={() => setCustomAlias("")} aria-label="清空显示文字"><X size={15} /></button>}
        </span></label>}
      </div>
      <div ref={listRef} id="internal-link-results" className="internal-link-results" role="listbox" aria-label="内部链接目标" aria-busy={loading}
        onMouseLeave={() => { if (activeSource === "pointer") { setActiveIndex(null); setActiveSource(null); } }}>
        {loading && results.length === 0 ? <LinkState kind="loading" title="正在读取目标" />
          : error && results.length === 0 ? <LinkState kind="error" title={error} onRetry={searchNow} />
            : results.length === 0 ? <LinkState kind="empty" title="没有匹配的日志或小节" />
              : results.map((candidate, index) => <button key={`${candidate.kind}-${candidate.date}-${candidate.heading || ""}-${index}`}
                id={`internal-link-result-${index}`} type="button" className={index === activeIndex ? "active" : ""} role="option" aria-selected={index === activeIndex}
                disabled={!canChoose} onMouseEnter={() => { setActiveIndex(index); setActiveSource("pointer"); }} onClick={() => chooseCandidate(candidate)}>
                <span className="internal-link-result-icon" aria-hidden="true">{candidate.kind === "day" ? <CalendarDays size={17} /> : <FileText size={17} />}</span>
                <span className="internal-link-result-copy"><strong>{candidate.kind === "day" ? `${candidate.date} 的日志` : candidate.heading}</strong>
                  {candidate.kind === "heading" && <small>{candidate.date}</small>}{candidate.preview && <span>{candidate.preview}</span>}</span>
                <span className="internal-link-result-action">插入</span>
              </button>)}
        <div ref={sentinelRef} className="internal-link-load-sentinel" aria-hidden="true" />
      </div>
      <div className="internal-link-results-status" role={error || moreError ? "alert" : "status"}>
        {error ? <><span>{error}{results.length > 0 ? "；已保留上次结果，请重试后选择。" : ""}</span><button type="button" onClick={searchNow}>重试</button></>
          : moreError ? <><span>未能加载更多，已保留现有结果。</span><button type="button" onClick={() => void loadMore()}>重试</button></>
            : loading ? "正在更新结果…" : loadingMore ? "正在加载更多…" : results.length === 0 ? null
              : <span>{query.trim() || date ? (hasMore ? `已显示 ${results.length} 个匹配项，向下滚动查看更多` : `找到 ${results.length} 个匹配项`) : "最近的日志与小节"}</span>}
      </div>
    </section>
  </div>;
}

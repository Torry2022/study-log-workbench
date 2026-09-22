"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { History, Search, X } from "lucide-react";
import { requestJson } from "@/lib/client-http";
import type { SearchResult } from "@/lib/log-search";
import { useSearchHistory } from "@/hooks/use-search-history";
import "@/app/search.css";

export type SearchSelection = SearchResult & { query: string; ignoreCase: boolean; scope: "all" | "heading" };
export interface SearchBoxProps {
  active: boolean;
  onSelect: (result: SearchSelection) => Promise<boolean>;
  onQueryChange?: () => void;
}

export function SearchBox({ active, onSelect, onQueryChange }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [headingsOnly, setHeadingsOnly] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const enabled = useRef(active);
  enabled.current = active;
  const selectingRef = useRef(false);
  const { history, remember, remove, clear } = useSearchHistory();
  const trimmed = query.trim();
  const showingHistory = !trimmed && !submitted && history.length > 0;
  const candidateCount = showingHistory ? history.length : results.length;
  const visible = active && open && (showingHistory || submitted || loading || Boolean(error));

  function cancelRequest() { request.current?.abort(); request.current = null; sequence.current++; }
  function close() { setOpen(false); setIndex(-1); }

  useEffect(() => {
    if (!active) {
      cancelRequest(); setLoading(false); selectingRef.current = false; setSelecting(false); close();
    }
  }, [active]);
  useEffect(() => {
    enabled.current = active;
    return () => { enabled.current = false; cancelRequest(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !area.current?.contains(event.target)) close();
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [visible]);
  useEffect(() => {
    if (visible && index >= 0) area.current?.querySelector<HTMLElement>(`[data-search-candidate-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [visible, index]);

  async function runSearch(text = trimmed, caseInsensitive = ignoreCase, titleOnly = headingsOnly) {
    const normalized = text.trim();
    if (!enabled.current || !normalized || selectingRef.current) return;
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    const current = sequence.current;
    setLoading(true); setError(""); setResults([]); setSubmitted(true); setOpen(true); setIndex(-1);
    try {
      const params = new URLSearchParams({ q: normalized, ignoreCase: String(caseInsensitive), scope: titleOnly ? "heading" : "all" });
      const response = await requestJson<{ results: SearchResult[] }>(`/api/search?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted && current === sequence.current && enabled.current) setResults(response.results);
    } catch (failure) {
      if (!controller.signal.aborted && current === sequence.current && enabled.current) setError(failure instanceof Error ? failure.message : "搜索失败，请重试");
    } finally {
      if (current === sequence.current) { request.current = null; setLoading(false); }
    }
  }

  function changeQuery(text: string) {
    onQueryChange?.();
    cancelRequest(); setLoading(false); setQuery(text); setResults([]); setSubmitted(false); setError(""); close();
  }
  function selectHistory(text: string) {
    if (!enabled.current || selectingRef.current) return;
    onQueryChange?.();
    setQuery(text); remember(text); void runSearch(text);
  }
  async function selectResult(result: SearchResult) {
    if (!enabled.current || selectingRef.current || loading) return;
    const current = sequence.current;
    selectingRef.current = true; setSelecting(true); setError("");
    try {
      const accepted = await onSelect({ ...result, query: trimmed, ignoreCase, scope: headingsOnly ? "heading" : "all" });
      if (accepted && enabled.current && current === sequence.current) { setResults([]); setSubmitted(false); close(); }
    } catch (failure) {
      if (enabled.current && current === sequence.current) { setError(failure instanceof Error ? failure.message : "打开结果失败，请重试"); setOpen(true); }
    } finally {
      if (current === sequence.current) { selectingRef.current = false; setSelecting(false); }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (loading || selecting) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && candidateCount) {
      event.preventDefault(); setOpen(true);
      setIndex(current => current < 0 ? (event.key === "ArrowDown" ? 0 : candidateCount - 1)
        : (current + (event.key === "ArrowDown" ? 1 : -1) + candidateCount) % candidateCount);
    } else if (event.key === "Enter" && visible && index >= 0) {
      event.preventDefault();
      if (showingHistory && history[index]) selectHistory(history[index]);
      else if (results[index]) void selectResult(results[index]);
    }
  }

  return <div className="search-area" ref={area}>
    <form className="search-form" onSubmit={event => { event.preventDefault(); remember(trimmed); void runSearch(); }}>
      <Search size={16} aria-hidden="true" />
      <input ref={input} value={query} disabled={!active || selecting} maxLength={500}
        onChange={event => changeQuery(event.target.value)} onKeyDown={keyDown}
        onFocus={() => { if (showingHistory || submitted || loading || error) setOpen(true); }}
        placeholder={headingsOnly ? "搜索小节标题" : "搜索日志、术语、代码标识"}
        aria-label="搜索全部日志" role="combobox" aria-autocomplete="list"
        aria-controls="global-search-popover" aria-expanded={visible}
        aria-activedescendant={visible && index >= 0 && index < candidateCount ? `search-candidate-${index}` : undefined} />
      <button type="button" className={`search-heading-toggle${headingsOnly ? " active" : ""}`} disabled={!active || selecting}
        aria-pressed={headingsOnly} title={headingsOnly ? "仅搜索小节标题" : "搜索标题和正文"}
        aria-label={headingsOnly ? "当前仅搜索小节标题，点击后搜索标题和正文" : "当前搜索标题和正文，点击后仅搜索小节标题"}
        onClick={() => { onQueryChange?.(); const next = !headingsOnly; setHeadingsOnly(next); if (trimmed && submitted) void runSearch(trimmed, ignoreCase, next); }}>H3</button>
      <button type="button" className={`search-case-toggle${ignoreCase ? "" : " active"}`} disabled={!active || selecting}
        aria-pressed={!ignoreCase} title={ignoreCase ? "忽略大小写" : "区分大小写"}
        aria-label={ignoreCase ? "搜索时忽略大小写，点击后区分大小写" : "搜索时区分大小写，点击后忽略大小写"}
        onClick={() => { onQueryChange?.(); const next = !ignoreCase; setIgnoreCase(next); if (trimmed && submitted) void runSearch(trimmed, next); }}>Aa</button>
      <button className="search-submit" type="submit" disabled={!active || !trimmed || loading || selecting} aria-label="搜索" title="搜索"><Search size={14} /></button>
      {(query || submitted) && <button className="search-clear" type="button" disabled={!active || selecting}
        onClick={() => { changeQuery(""); input.current?.focus(); }} aria-label="清空搜索"><X size={15} /></button>}
    </form>
    {visible && <div className="search-popover" id="global-search-popover" role="listbox" aria-label="日志搜索结果" aria-busy={loading || selecting}>
      {loading ? <div className="search-empty" role="status">正在搜索日志</div> : showingHistory ? <div className="search-history">
        <div className="search-history-header"><span>最近搜索</span><button type="button" onClick={() => { clear(); close(); }}>清除</button></div>
        {history.map((term, candidate) => <div key={term} className={`search-history-item${candidate === index ? " keyboard-active" : ""}`} data-search-candidate-index={candidate}>
          <button id={`search-candidate-${candidate}`} type="button" role="option" aria-selected={candidate === index} onClick={() => selectHistory(term)}><History size={14} aria-hidden="true" /><span>{term}</span></button>
          <button type="button" aria-label={`删除搜索记录：${term}`} title="删除记录" onClick={() => { remove(term); setIndex(-1); if (history.length === 1) close(); }}><X size={14} aria-hidden="true" /></button>
        </div>)}
      </div> : <>
        {results.map((result, candidate) => <button key={result.date} id={`search-candidate-${candidate}`} type="button"
          className={`result-item${candidate === index ? " keyboard-active" : ""}`} role="option" aria-selected={candidate === index}
          data-search-candidate-index={candidate} disabled={selecting} onClick={() => void selectResult(result)}>
          <strong>{result.date}</strong><span>{result.matches[0]}</span>
        </button>)}
        {error ? <div className="search-empty search-error" role="alert"><span>{error}</span>
          {!results.length && <button type="button" className="button secondary" onClick={() => void runSearch()}>重试</button>}
        </div> : !results.length && <div className="search-empty" role="status">{headingsOnly ? "未找到匹配的小节标题" : "未找到匹配内容"}</div>}
      </>}
    </div>}
  </div>;
}

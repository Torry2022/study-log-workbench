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
  const [customAlias, setCustomAlias] = useState("");
  const [results, setResults] = useState<InternalLinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<"keyboard" | "pointer" | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [retry, setRetry] = useState(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { backdropRef, requestExit } = useDialogExit<HTMLDivElement>(closeDialog);

  function closeDialog() {
    requestExit(onClose);
  }

  function chooseCandidate(candidate: InternalLinkCandidate) {
    const alias = initialAlias || customAlias;
    try {
      const markdown = buildInternalLinkMarkup(candidate, alias);
      setError("");
      requestExit(() => onInsert(markdown));
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "无法创建内部链接");
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    setError("");
    setActiveIndex(null);
    setActiveSource(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await requestJson<{ results: InternalLinkCandidate[] }>(
          `/api/links?query=${encodeURIComponent(query)}`, { signal: controller.signal }
        );
        if (!controller.signal.aborted) setResults(response.results);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "读取链接目标失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, retry]);

  useEffect(() => {
    if (activeSource === "keyboard" && activeIndex !== null) {
      resultsRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, activeSource]);

  return (
    <div ref={backdropRef} className="internal-link-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section
        className="internal-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="internal-link-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="internal-link-dialog-header">
          <div>
            <span aria-hidden="true"><Link2 size={19} /></span>
            <div>
              <h2 id="internal-link-dialog-title">插入内部链接</h2>
              <p>选择日志或小节，自动生成跳转语法。</p>
            </div>
          </div>
          <button type="button" onClick={closeDialog} aria-label="关闭内部链接选择器"><X size={18} /></button>
        </header>

        <div className={`internal-link-dialog-controls${initialAlias ? "" : " has-alias"}`}>
          <label className="internal-link-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInputRef}
              aria-label="搜索日期、小节标题或正文"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="internal-link-results"
              aria-activedescendant={activeIndex !== null && results[activeIndex] ? `internal-link-result-${activeIndex}` : undefined}
              value={query}
              onChange={(event) => {
                setLoading(true);
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || loading || !results.length) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.min((current ?? -1) + 1, Math.max(results.length - 1, 0)));
                  setActiveSource("keyboard");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max((current ?? 0) - 1, 0));
                  setActiveSource("keyboard");
                } else if (event.key === "Enter" && activeIndex !== null && results[activeIndex]) {
                  event.preventDefault();
                  chooseCandidate(results[activeIndex]);
                }
              }}
            />
            <span className={query ? "has-value" : ""}>搜索日期、小节标题或正文</span>
            {query && (
              <button type="button" onClick={() => {
                setLoading(true);
                setQuery("");
              }} aria-label="清空目标搜索">
                <X size={15} />
              </button>
            )}
          </label>

          {!initialAlias && (
            <label className="internal-link-alias">
              <TextCursorInput size={16} aria-hidden="true" />
              <span className="sr-only">自定义显示文字</span>
              <input
                value={customAlias}
                onChange={(event) => setCustomAlias(event.target.value)}
                placeholder="显示文字（默认用目标标题）"
                aria-label="自定义显示文字"
              />
              {customAlias && (
                <button type="button" onClick={() => setCustomAlias("")} aria-label="清空显示文字">
                  <X size={15} />
                </button>
              )}
            </label>
          )}
        </div>

        <div
          ref={resultsRef}
          id="internal-link-results"
          className="internal-link-results"
          aria-busy={loading}
          role="listbox"
          aria-label="内部链接目标"
          onMouseLeave={() => {
            if (activeSource === "pointer") {
              setActiveIndex(null);
              setActiveSource(null);
            }
          }}
        >
          {loading && results.length === 0 ? (
            <LinkState kind="loading" title="正在读取目标" />
          ) : error && results.length === 0 ? (
            <LinkState kind="error" title={error} onRetry={() => setRetry(value => value + 1)} />
          ) : results.length === 0 ? (
            <LinkState kind="empty" title="没有匹配的日志或小节" />
          ) : (
            results.map((candidate, index) => (
              <button
                key={`${candidate.kind}-${candidate.date}-${candidate.heading || ""}-${index}`}
                id={`internal-link-result-${index}`}
                type="button"
                disabled={loading}
                className={index === activeIndex ? "active" : ""}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => {
                  setActiveIndex(index);
                  setActiveSource("pointer");
                }}
                onClick={() => chooseCandidate(candidate)}
              >
                <span className="internal-link-result-icon" aria-hidden="true">
                  {candidate.kind === "day" ? <CalendarDays size={17} /> : <FileText size={17} />}
                </span>
                <span className="internal-link-result-copy">
                  <strong>{candidate.heading || `${candidate.date} 日志`}</strong>
                  <small>{candidate.date}{candidate.kind === "day" ? " · 跳转到日志顶部" : ""}</small>
                  {candidate.preview && <span>{candidate.preview}</span>}
                </span>
                <span className="internal-link-result-action">插入</span>
              </button>
            ))
          )}
        </div>

        {error && results.length > 0 ? <p role="alert" className="internal-link-dialog-error">{error}</p> : initialAlias ? <p className="internal-link-selection">显示文字：{initialAlias}</p> : null}
      </section>
    </div>
  );
}

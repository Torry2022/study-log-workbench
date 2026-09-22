"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { MonthSummary } from "@/lib/types";
import { AUTH_EXPIRED_EVENT, requestLogJson } from "@/lib/client-http";
import { buildMonthCalendar, recordedDates, shiftMonth, validMonth } from "@/lib/date-jump";
import { todayInShanghai } from "@/lib/study-date";
import "@/app/date-jump.css";

export interface DateJumpProps {
  months: MonthSummary[];
  selectedDate: string;
  active: boolean;
  onDate: (date: string) => void;
  /** Chrome handles Ctrl+G and reveals the sidebar before supplying a new token. */
  openRequest?: number;
}

interface CalendarResult {
  month: string;
  status: "loading" | "ready" | "error";
  dates: Set<string>;
  error: string;
}

export function DateJump({ months, selectedDate, active, onDate, openRequest = 0 }: DateJumpProps) {
  const today = todayInShanghai();
  const currentMonth = today.slice(0, 7);
  const knownMonths = months.map(item => item.id).filter(validMonth).sort();
  const minimum = knownMonths[0] || currentMonth;
  const maximum = [currentMonth, knownMonths.at(-1) || currentMonth].sort().at(-1)!;
  const initialMonth = validMonth(selectedDate.slice(0, 7)) ? selectedDate.slice(0, 7) : knownMonths.at(-1) || currentMonth;
  const initial = initialMonth < minimum ? minimum : initialMonth > maximum ? maximum : initialMonth;
  const [open, setOpen] = useState(active && openRequest > 0);
  const [month, setMonth] = useState(initial);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<CalendarResult>({ month: "", status: "loading", dates: new Set(), error: "" });
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const monthInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const handledRequest = useRef(0);
  const loading = result.month !== month || result.status === "loading";
  const available = result.month === month && result.status === "ready" ? result.dates : new Set<string>();
  const error = result.month === month && result.status === "error" ? result.error : "";

  function close(restoreFocus: boolean) {
    request.current?.abort();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!active) { request.current?.abort(); handledRequest.current = openRequest; setOpen(false); return; }
    if (openRequest > 0 && openRequest !== handledRequest.current) {
      handledRequest.current = openRequest;
      setResult({ month: initial, status: "loading", dates: new Set(), error: "" });
      setMonth(initial); setOpen(true);
    }
  }, [active, openRequest, initial]);

  useEffect(() => {
    const expire = () => { request.current?.abort(); setOpen(false); };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => { window.removeEventListener(AUTH_EXPIRED_EVENT, expire); request.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!active || !open) return;
    const controller = new AbortController();
    request.current = controller;
    setResult({ month, status: "loading", dates: new Set(), error: "" });
    requestLogJson<{ days: unknown }>(`/api/logs?month=${encodeURIComponent(month)}`, controller.signal)
      .then(payload => {
        if (controller.signal.aborted) return;
        const dates = recordedDates(payload.days, month);
        setResult({ month, status: "ready", dates, error: "" });
      })
      .catch(error => {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
        setResult({ month, status: "error", dates: new Set(), error: error instanceof Error ? error.message : "日期目录读取失败，请重试" });
      });
    return () => { controller.abort(); if (request.current === controller) request.current = null; };
  }, [active, open, month, retry]);

  useEffect(() => {
    if (!active || !open) return;
    const frame = requestAnimationFrame(() => monthInput.current?.focus());
    const outside = (event: PointerEvent) => {
      if (!control.current?.contains(event.target as Node)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); close(true);
    };
    document.addEventListener("pointerdown", outside);
    // A calendar nested inside the mobile drawer closes before its parent drawer.
    document.addEventListener("keydown", escape, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [active, open]);

  function chooseMonth(next: string) {
    if (validMonth(next) && next >= minimum && next <= maximum) setMonth(next);
  }

  return <div className="date-jump-control" ref={control} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(false);
  }}>
    <button ref={trigger} className={`date-jump-trigger${open ? " active" : ""}`} type="button" disabled={!active || months.length === 0}
      title="跳转到指定日期（Ctrl+G）" aria-label="按日期跳转" aria-haspopup="dialog" aria-expanded={active && open}
      onClick={() => { if (open) close(false); else { setResult({ month: initial, status: "loading", dates: new Set(), error: "" }); setMonth(initial); setOpen(true); } }}><CalendarDays size={15} /></button>
    {active && open && <div className="date-jump-popover" role="dialog" aria-label="跳转到指定日期">
      <div className="date-jump-header">
        <button type="button" disabled={month <= minimum} onClick={() => chooseMonth(shiftMonth(month, -1))} aria-label="上一个月"><ChevronLeft size={16} /></button>
        <input ref={monthInput} type="month" value={month} min={minimum} max={maximum} onChange={event => chooseMonth(event.target.value)} aria-label="选择跳转月份" />
        <button type="button" disabled={month >= maximum} onClick={() => chooseMonth(shiftMonth(month, 1))} aria-label="下一个月"><ChevronRight size={16} /></button>
      </div>
      <div className="date-jump-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
      <div className="date-jump-calendar" aria-busy={loading}>
        {buildMonthCalendar(month).map((date, index) => {
          if (!date) return <span className="date-jump-spacer" key={`spacer-${index}`} />;
          const className = `date-jump-day${date === selectedDate ? " active" : ""}${date === today ? " today" : ""}`;
          return available.has(date) ? <button className={className} key={date} type="button" aria-label={`跳转到 ${date}`} aria-current={date === selectedDate ? "date" : undefined}
            onClick={() => { if (!active || !available.has(date)) return; close(true); onDate(date); }}>{Number(date.slice(-2))}<span aria-hidden="true" /></button>
            : <span className={`${className} unavailable`} key={date} title={`${date} ${loading ? "正在读取" : error ? "目录未能读取" : "暂无日志"}`}>{Number(date.slice(-2))}</span>;
        })}
        {loading && <span className="date-jump-loading" role="status">正在读取</span>}
      </div>
      {error ? <div className="date-jump-footer" role="alert"><span>{error}</span><button className="button secondary full" type="button" onClick={() => setRetry(value => value + 1)}>重试读取日期</button></div>
        : <div className="date-jump-footer">有记录的日期可直接跳转</div>}
    </div>}
  </div>;
}

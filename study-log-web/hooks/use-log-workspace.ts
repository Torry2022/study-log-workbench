"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestLogJson } from "@/lib/client-http";
import { isValidLogDate } from "@/lib/study-date";
import type { DayEntry, DaySummary, MonthSummary } from "@/lib/types";

interface Selection { month: string; date: string; heading: string }
const empty: Selection = { month: "", date: "", heading: "" };

function readLocation(): Selection {
  const url = new URL(window.location.href);
  const date = url.searchParams.get("date") || "";
  const month = url.searchParams.get("month") || "";
  const heading = url.searchParams.get("heading") || "";
  return {
    month: isValidLogDate(date) ? date.slice(0, 7) : /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
    date: isValidLogDate(date) ? date : "",
    heading: heading.length <= 4096 && !/[\u0000-\u001f]/.test(heading) ? heading : ""
  };
}

function writeLocation(selection: Selection, replace = false) {
  const url = new URL(window.location.href);
  for (const name of ["view", "month", "date", "heading"]) url.searchParams.delete(name);
  url.searchParams.set("view", "log");
  if (selection.month) url.searchParams.set("month", selection.month);
  if (selection.date) url.searchParams.set("date", selection.date);
  if (selection.heading) url.searchParams.set("heading", selection.heading);
  if (url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"](replace ? window.history.state : {}, "", url);
}

const cancelled = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof Error && error.name === "AbortError");

export function useLogWorkspace(active: boolean) {
  const [selection, setSelection] = useState<Selection>(empty);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const monthsRef = useRef<MonthSummary[]>([]);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [day, setDay] = useState<DayEntry | null>(null);
  const [errors, setErrors] = useState({ months: "", days: "", day: "" });
  const [loading, setLoading] = useState({ months: false, days: false, day: false });
  const [revision, setRevision] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<number | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);

  useEffect(() => {
    const restore = () => {
      const target = readLocation();
      if (!target.month) target.month = monthsRef.current[0]?.id || "";
      setSelection(target);
      setNavigationRevision(value => value + 1);
      const saved = window.history.state?.studyLogScrollY;
      setScrollTarget(Number.isFinite(saved) ? saved : null);
    };
    restore();
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("popstate", restore); window.history.scrollRestoration = previous; };
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(value => ({ ...value, months: true }));
    setErrors(value => ({ ...value, months: "" }));
    requestLogJson<{ months: MonthSummary[] }>("/api/logs/months", controller.signal)
      .then(result => {
        monthsRef.current = result.months;
        setMonths(result.months);
        setSelection(current => current.month ? current : { ...empty, month: result.months[0]?.id || "" });
      })
      .catch(error => { if (!cancelled(error, controller.signal)) setErrors(value => ({ ...value, months: error.message })); })
      .finally(() => { if (!controller.signal.aborted) setLoading(value => ({ ...value, months: false })); });
    return () => controller.abort();
  }, [active, revision]);

  useEffect(() => {
    if (!active || !selection.month) return;
    const month = selection.month;
    const controller = new AbortController();
    setDays([]);
    setLoading(value => ({ ...value, days: true }));
    setErrors(value => ({ ...value, days: "" }));
    requestLogJson<{ days: DaySummary[] }>(`/api/logs?month=${encodeURIComponent(month)}`, controller.signal)
      .then(result => {
        setDays(result.days);
        setSelection(current => {
          if (current.month !== month || current.date) return current;
          const next = { ...current, date: result.days[0]?.date || "" };
          return next;
        });
      })
      .catch(error => { if (!cancelled(error, controller.signal)) setErrors(value => ({ ...value, days: error.message })); })
      .finally(() => { if (!controller.signal.aborted) setLoading(value => ({ ...value, days: false })); });
    return () => controller.abort();
  }, [active, selection.month, revision]);

  useEffect(() => {
    if (!active) return;
    setDay(null);
    setErrors(value => ({ ...value, day: "" }));
    if (!selection.date) { setLoading(value => ({ ...value, day: false })); return; }
    const controller = new AbortController();
    setLoading(value => ({ ...value, day: true }));
    requestLogJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(selection.date)}`, controller.signal)
      .then(result => setDay(result.day))
      .catch(error => { if (!cancelled(error, controller.signal)) setErrors(value => ({ ...value, day: error.message })); })
      .finally(() => { if (!controller.signal.aborted) setLoading(value => ({ ...value, day: false })); });
    return () => controller.abort();
  }, [active, selection.date, revision]);

  useEffect(() => {
    if (selection.month) writeLocation(selection, true);
  }, [selection]);

  const navigate = useCallback((next: Selection) => {
    window.history.replaceState({ ...window.history.state, studyLogScrollY: window.scrollY }, "");
    setScrollTarget(null);
    setNavigationRevision(value => value + 1);
    setSelection(next); writeLocation(next);
  }, []);
  const selectMonth = (month: string) => navigate({ month, date: "", heading: "" });
  const selectDate = (date: string, heading = "") => navigate({ month: date.slice(0, 7), date, heading });
  return {
    months, days, day: day?.date === selection.date ? day : null, selection, selectMonth, selectDate, scrollTarget, navigationRevision,
    navigationLoading: loading.months || loading.days,
    navigationError: errors.months || errors.days,
    loading: loading.months || loading.days || loading.day,
    error: errors.months || errors.days || errors.day,
    retry: () => setRevision(value => value + 1)
  };
}

"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { requestLogJson } from "@/lib/client-http";
import { isValidLogDate } from "@/lib/study-date";
import type { DayEntry, DaySummary, MonthSummary } from "@/lib/types";

export type WorkspaceView = "log" | "favorites" | "notes" | "stats" | "qa";
interface Selection { view: WorkspaceView; month: string; date: string; heading: string; noteId: string; statsMonth: string; sessionId: string }
const empty: Selection = { view: "log", month: "", date: "", heading: "", noteId: "", statsMonth: "", sessionId: "" };

function needsLeave(current: Selection, next: Selection) {
  return current.view !== next.view || current.date !== next.date ||
    (current.view === "notes" && current.noteId !== next.noteId) ||
    (current.view === "stats" && current.statsMonth !== next.statsMonth) ||
    (current.view === "qa" && current.sessionId !== next.sessionId);
}

function readLocation(): Selection {
  const url = new URL(window.location.href);
  const date = url.searchParams.get("date") || "";
  const month = url.searchParams.get("month") || "";
  const heading = url.searchParams.get("heading") || "";
  const view = url.searchParams.get("view") || "log";
  const noteId = url.searchParams.get("note") || "";
  const sessionId = url.searchParams.get("session") || "";
  return {
    view: ["favorites", "notes", "stats", "qa"].includes(view) ? view as WorkspaceView : "log",
    sessionId: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(sessionId) ? sessionId.toLowerCase() : "",
    noteId: noteId.length <= 4096 && !/[\u0000-\u001f]/.test(noteId) ? noteId : "",
    statsMonth: view === "stats" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
    month: isValidLogDate(date) ? date.slice(0, 7) : /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
    date: isValidLogDate(date) ? date : "",
    heading: heading.length <= 4096 && !/[\u0000-\u001f]/.test(heading) ? heading : ""
  };
}

function writeLocation(selection: Selection, replace = false) {
  const url = new URL(window.location.href);
  for (const name of ["view", "month", "date", "heading", "note", "session"]) url.searchParams.delete(name);
  url.searchParams.set("view", selection.view);
  if (selection.view === "stats" && selection.statsMonth) url.searchParams.set("month", selection.statsMonth);
  else if (selection.view !== "stats" && selection.month) url.searchParams.set("month", selection.month);
  if (selection.view === "notes" && selection.noteId) url.searchParams.set("note", selection.noteId);
  if (selection.view === "qa" && selection.sessionId) url.searchParams.set("session", selection.sessionId);
  if (selection.date) url.searchParams.set("date", selection.date);
  if (selection.heading) url.searchParams.set("heading", selection.heading);
  const index = Number.isInteger(window.history.state?.studyLogIndex) ? window.history.state.studyLogIndex : 0;
  if (replace || url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"](
    replace ? { ...window.history.state, studyLogIndex: index } : { studyLogIndex: index + 1 }, "", url);
}

const cancelled = (error: unknown, signal: AbortSignal) => signal.aborted || (error instanceof Error && error.name === "AbortError");

export function useLogWorkspace(active: boolean, beforeLeave?: RefObject<() => Promise<boolean>>) {
  const [selection, setSelection] = useState<Selection>(empty);
  const [months, setMonths] = useState<MonthSummary[]>([]);
  const monthsRef = useRef<MonthSummary[]>([]);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [day, setDay] = useState<DayEntry | null>(null);
  const [errors, setErrors] = useState({ months: "", days: "", day: "" });
  const [loading, setLoading] = useState({ months: false, days: false, day: false });
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<number | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const acceptedIndex = useRef(0);
  const navigationAttempt = useRef(0);

  useEffect(() => {
    const restore = async (initial = false) => {
      const attempt = ++navigationAttempt.current;
      const target = readLocation();
      if (!target.statsMonth) target.statsMonth = currentSelection.current.statsMonth;
      if (!target.month) target.month = monthsRef.current[0]?.id || "";
      if (!initial && needsLeave(currentSelection.current, target) && beforeLeave?.current) {
        const accepted = await beforeLeave.current();
        if (attempt !== navigationAttempt.current) return;
        if (!accepted) {
          const index = window.history.state?.studyLogIndex;
          if (Number.isInteger(index) && index !== acceptedIndex.current) window.history.go(acceptedIndex.current - index);
          else writeLocation(currentSelection.current, true);
          return;
        }
      }
      acceptedIndex.current = window.history.state?.studyLogIndex || 0;
      currentSelection.current = target;
      setSelection(target);
      setNavigationRevision(value => value + 1);
      const saved = window.history.state?.studyLogScrollY;
      setScrollTarget(Number.isFinite(saved) ? saved : null);
    };
    void restore(true);
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const onPopState = () => { void restore(); };
    window.addEventListener("popstate", onPopState);
    return () => { navigationAttempt.current++; window.removeEventListener("popstate", onPopState); window.history.scrollRestoration = previous; };
  }, [beforeLeave]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(value => ({ ...value, months: true }));
    setErrors(value => ({ ...value, months: "" }));
    requestLogJson<{ months: MonthSummary[] }>("/api/logs/months", controller.signal)
      .then(result => {
        monthsRef.current = result.months;
        setMonths(result.months);
        setSelection(current => current.month ? current : { ...current, month: result.months[0]?.id || "" });
      })
      .catch(error => { if (!cancelled(error, controller.signal)) setErrors(value => ({ ...value, months: error.message })); })
      .finally(() => { if (!controller.signal.aborted) setLoading(value => ({ ...value, months: false })); });
    return () => controller.abort();
  }, [active, revision, listRevision]);

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
  }, [active, selection.month, revision, listRevision]);

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
    if (selection.month) { writeLocation(selection, true); acceptedIndex.current = window.history.state.studyLogIndex; }
  }, [selection]);

  const navigate = useCallback(async (next: Selection) => {
    const attempt = ++navigationAttempt.current;
    if (needsLeave(currentSelection.current, next) && beforeLeave?.current && !(await beforeLeave.current())) return false;
    if (attempt !== navigationAttempt.current) return false;
    const resetLogScroll = next.view === "log" && !next.heading &&
      (next.date !== currentSelection.current.date || next.month !== currentSelection.current.month);
    window.history.replaceState({ ...window.history.state, studyLogScrollY: window.scrollY }, "");
    if (resetLogScroll) window.scrollTo({ top: 0, behavior: "instant" });
    setScrollTarget(null);
    setNavigationRevision(value => value + 1);
    currentSelection.current = next;
    setSelection(next); writeLocation(next);
    acceptedIndex.current = window.history.state?.studyLogIndex || 0;
    return true;
  }, [beforeLeave]);
  const selectMonth = useCallback((month: string) => {
    const current = currentSelection.current;
    // Re-selecting the current month must not clear a day that is already open.
    if (current.month === month) {
      if (current.view !== "log") void navigate({ ...current, view: "log" });
      return;
    }
    void navigate({ ...current, view: "log", month, date: "", heading: "" });
  }, [navigate]);
  const selectDate = useCallback((date: string, heading = "") => navigate({ ...currentSelection.current, view: "log", month: date.slice(0, 7), date, heading }), [navigate]);
  const selectView = useCallback((view: WorkspaceView) => navigate({ ...currentSelection.current, view }), [navigate]);
  const selectNote = useCallback((noteId: string) => navigate({ ...currentSelection.current, view: "notes", noteId }), [navigate]);
  const selectStatsMonth = useCallback((statsMonth: string) => navigate({ ...currentSelection.current, view: "stats", statsMonth }), [navigate]);
  const selectRagSession = useCallback((sessionId: string) => navigate({ ...currentSelection.current, view: "qa", sessionId }), [navigate]);
  // A successful save updates the current address without navigating away from its answer.
  const replaceRagSession = useCallback((sessionId: string) => {
    const next = { ...currentSelection.current, sessionId }; currentSelection.current = next;
    setSelection(next); writeLocation(next, true);
  }, []);
  const acceptSaved = useCallback((saved: DayEntry) => {
    if (saved.date === currentSelection.current.date) setDay(saved);
    setListRevision(value => value + 1);
  }, []);
  const acceptDeleted = useCallback((deleted: DayEntry) => {
    if (deleted.date === currentSelection.current.date) {
      const next = { ...currentSelection.current, month: "", date: "", heading: "" };
      currentSelection.current = next;
      setSelection(next); setDay(null); setDays([]); setMonths([]); monthsRef.current = [];
      writeLocation(next, true);
      setNavigationRevision(value => value + 1);
    }
    setListRevision(value => value + 1);
  }, []);
  return {
    months, days, day: day?.date === selection.date ? day : null, selection, selectMonth, selectDate, selectView, selectNote, selectStatsMonth, selectRagSession, replaceRagSession, scrollTarget, navigationRevision,
    navigationLoading: loading.months || loading.days,
    navigationError: errors.months || errors.days,
    acceptSaved, acceptDeleted,
    loading: loading.day || (!selection.month && loading.months) || (!selection.date && loading.days),
    error: errors.months || errors.days || errors.day,
    retry: () => setRevision(value => value + 1)
  };
}

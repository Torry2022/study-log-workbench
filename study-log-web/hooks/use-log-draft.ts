"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { assertEditableDayBody, toEditableDayBody } from "@/lib/day-content";
import type { DayEntry } from "@/lib/types";

interface Draft { date: string; body: string; savedBody: string; version: string | null }
const fromDay = (day: DayEntry): Draft => {
  const body = toEditableDayBody(day.date, day.content);
  return { date: day.date, body, savedBody: body, version: day.version };
};

export function useLogDraft(day: DayEntry | null, active: boolean, onSaved: (day: DayEntry) => void) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef(draft);
  current.current = draft;
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const dirty = Boolean(draft && draft.body !== draft.savedBody);

  useEffect(() => {
    if (!day) return;
    setDraft(previous => !previous || previous.date !== day.date || previous.body === previous.savedBody ? fromDay(day) : previous);
  }, [day]);
  useEffect(() => { setError(""); setConflict(false); setSaved(false); }, [draft?.date]);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 3600);
    return () => window.clearTimeout(timer);
  }, [saved]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  function change(body: string) {
    if (!current.current) return;
    const next = { ...current.current, body };
    current.current = next; setDraft(next); setSaved(false);
  }
  function reset() { if (day) { const next = fromDay(day); current.current = next; setDraft(next); setError(""); setConflict(false); setSaved(false); setResetRevision(value => value + 1); } }
  function acceptExternal(day: DayEntry) {
    const next = fromDay(day); current.current = next; setDraft(next);
    setError(""); setConflict(false); setSaved(false); setResetRevision(value => value + 1);
  }
  async function save() {
    const submitted = current.current;
    if (!active || saving.current || !submitted) return;
    try { assertEditableDayBody(submitted.body); }
    catch (error) { setError(error instanceof Error ? error.message : "正文格式无效"); return; }
    saving.current = true; setBusy(true); setError(""); setConflict(false); setSaved(false);
    try {
      const result = await requestJson<{ day: DayEntry }>("/api/logs/day", {
        method: "PUT", body: JSON.stringify({ date: submitted.date, content: submitted.body, baseVersion: submitted.version })
      });
      setDraft(previous => {
        if (!previous || previous.date !== submitted.date) return previous;
        const next = fromDay(result.day);
        return { ...next, body: previous.body === submitted.body ? next.body : previous.body };
      });
      setSaved(true); onSaved(result.day);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setConflict(error instanceof ApiRequestError && error.status === 409);
      setError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally { saving.current = false; setBusy(false); }
  }
  function replaceBody(body: string) { change(body); setResetRevision(value => value + 1); }
  return { draft, dirty, busy, error, conflict, saved, resetRevision, change, replaceBody, reset, acceptExternal, save };
}

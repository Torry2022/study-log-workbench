"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./AuthGate";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { LogReader } from "./LogReader";
import { useLogWorkspace } from "@/hooks/use-log-workspace";
import { useTheme } from "@/hooks/use-theme";
import { useLogDraft } from "@/hooks/use-log-draft";
import { useConfirmation } from "@/hooks/use-confirmation";
import { ConfirmDialog } from "./ConfirmDialog";
import type { WorkspaceMode } from "./LogReader";
import "@/app/editing-workspace.css";

export function Workspace() {
  const { active, logout } = useSession();
  const beforeLeave = useRef<() => Promise<boolean>>(async () => true);
  const logs = useLogWorkspace(active, beforeLeave);
  const draft = useLogDraft(logs.day, active, logs.acceptSaved);
  const { confirmation, confirm, resolveConfirmation } = useConfirmation();
  const [mode, setMode] = useState<WorkspaceMode>("preview");
  const { theme, preference, chooseTheme } = useTheme();
  const [reading, setReading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  beforeLeave.current = async () => {
    if (!active) return false;
    if (draft.busy) return false;
    if (!draft.dirty) return true;
    const accepted = await confirm({ title: "放弃未保存修改？", message: "当前日志有未保存修改，离开后将丢弃这些修改。", confirmLabel: "放弃修改", tone: "danger" });
    if (accepted) draft.reset();
    return accepted;
  };
  useEffect(() => { if (!active) resolveConfirmation(false); }, [active, resolveConfirmation]);
  useEffect(() => {
    if (!active) return;
    const save = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault(); if (draft.dirty || (logs.day && !logs.day.exists)) void draft.save();
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  }, [active, draft.dirty, draft.save, logs.day]);
  const reload = async () => { if (await beforeLeave.current()) { draft.reset(); logs.retry(); } };
  const exit = async () => {
    if (!(await beforeLeave.current())) return;
    setSessionError("");
    try { await logout(); } catch { setSessionError("退出失败，请重试"); }
  };
  return <><WorkspaceChrome active={active} months={logs.months} days={logs.days}
    selectedMonth={logs.selection.month} selectedDate={logs.selection.date}
    loading={logs.navigationLoading} error={logs.navigationError || sessionError} readingMode={reading}
    theme={theme} themePreference={preference} onTheme={chooseTheme}
    onMonth={logs.selectMonth} onDate={logs.selectDate} onRetry={logs.retry}
    onNewDate={date => { void logs.selectDate(date).then(accepted => { if (accepted) setMode("source"); }); }} onLogout={() => void exit()}>
    <LogReader active={active} day={logs.day} date={logs.selection.date} heading={logs.selection.heading}
      scrollTarget={logs.scrollTarget} navigationRevision={logs.navigationRevision} loading={logs.loading} error={logs.error} theme={theme}
      reading={reading} onReading={value => { if (value) setMode("preview"); setReading(value); }} onRetry={logs.retry} onNavigate={logs.selectDate}
      editing={{ mode, onMode: setMode, documentDate: draft.draft?.date || "", body: draft.draft?.body || "", dirty: draft.dirty,
        busy: draft.busy, error: draft.error, conflict: draft.conflict, saved: draft.saved,
        onChange: draft.change, onSave: () => void draft.save(), onReload: () => void reload(),
        onDiscard: () => { void beforeLeave.current(); } }} />
  </WorkspaceChrome>{confirmation && active && <ConfirmDialog {...confirmation} onConfirm={() => resolveConfirmation(true)} onCancel={() => resolveConfirmation(false)} />}</>;
}

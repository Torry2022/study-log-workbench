"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./AuthGate";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { LogReader } from "./LogReader";
import { useLogWorkspace } from "@/hooks/use-log-workspace";
import { useTheme } from "@/hooks/use-theme";
import { useLogDraft } from "@/hooks/use-log-draft";
import { useConfirmation } from "@/hooks/use-confirmation";
import { ConfirmDialog } from "./ConfirmDialog";
import { BackupDialog } from "./BackupDialog";
import { requestJson } from "@/lib/client-http";
import type { DayEntry } from "@/lib/types";
import type { SearchSelection } from "./SearchBox";
import { clearSearchSessionHistory } from "@/hooks/use-search-history";
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
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [searchSelection, setSearchSelection] = useState<SearchSelection | null>(null);
  const clearSearch = useCallback(() => setSearchSelection(null), []);
  const selectDate = useCallback(async (date: string, heading = "") => {
    const accepted = await logs.selectDate(date, heading);
    if (accepted) setSearchSelection(null);
    return accepted;
  }, [logs.selectDate]);
  beforeLeave.current = async () => {
    if (!active) return false;
    if (draft.busy || deleting || backupOpen) return false;
    if (!draft.dirty) return true;
    const accepted = await confirm({ title: "放弃未保存修改？", message: "当前日志有未保存修改，离开后将丢弃这些修改。", confirmLabel: "放弃修改", tone: "danger" });
    if (accepted) draft.reset();
    return accepted;
  };
  useEffect(() => { if (!active) { resolveConfirmation(false); setBackupOpen(false); } }, [active, resolveConfirmation]);
  useEffect(() => { setOperationError(""); }, [logs.selection.date]);
  useEffect(() => {
    if (!active) return;
    const save = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault(); if (!backupOpen && !deleting && (draft.dirty || (logs.day && !logs.day.exists))) void draft.save();
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  }, [active, draft.dirty, draft.save, logs.day, backupOpen, deleting]);
  const reload = async () => { if (await beforeLeave.current()) { draft.reset(); logs.retry(); } };
  const exit = async () => {
    if (!(await beforeLeave.current())) return;
    setSessionError("");
    try { await logout(); clearSearchSessionHistory(); } catch { setSessionError("退出失败，请重试"); }
  };
  const acceptExternal = (day: DayEntry) => { draft.acceptExternal(day); logs.acceptSaved(day); setOperationError(""); };
  const deleteCurrent = async () => {
    if (!active || draft.busy || deleting || !logs.day?.exists || !draft.draft) return;
    const date = logs.day.date;
    const version = draft.draft.version;
    if (!(await confirm({ title: "删除当前日块？", message: draft.dirty ? "当前有未保存修改。删除会移除这一天的日志，并保留写入前备份。" : "删除会移除这一天的日志，并保留写入前备份。", confirmLabel: "删除", tone: "danger" }))) return;
    setDeleting(true); setOperationError("");
    try {
      const { day } = await requestJson<{ day: DayEntry }>("/api/logs/day", { method: "DELETE", body: JSON.stringify({ date, baseVersion: version }) });
      acceptExternal(day); setMode("preview");
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setOperationError(error instanceof Error ? error.message : "删除失败，请重试"); }
    finally { setDeleting(false); }
  };
  return <><WorkspaceChrome active={active} months={logs.months} days={logs.days}
    selectedMonth={logs.selection.month} selectedDate={logs.selection.date}
    loading={logs.navigationLoading} error={logs.navigationError || sessionError} readingMode={reading}
    theme={theme} themePreference={preference} onTheme={chooseTheme}
    onMonth={month => { clearSearch(); logs.selectMonth(month); }} onDate={selectDate} onRetry={logs.retry}
    onSearchChange={clearSearch} onSearchSelect={async result => { if (!(await logs.selectDate(result.date))) return false; setMode("preview"); setReading(false); setSearchSelection(result); return true; }}
    onNewDate={date => { void logs.selectDate(date).then(accepted => { if (accepted) setMode("source"); }); }} onLogout={() => void exit()}>
    <LogReader active={active} day={logs.day} date={logs.selection.date} heading={logs.selection.heading}
      scrollTarget={logs.scrollTarget} navigationRevision={logs.navigationRevision} loading={logs.loading} error={logs.error} theme={theme}
      reading={reading} onReading={value => { if (value) setMode("preview"); setReading(value); }} onRetry={logs.retry} onNavigate={selectDate}
      search={searchSelection?.date === logs.selection.date ? searchSelection : null}
      editing={{ mode, onMode: setMode, documentDate: draft.draft?.date || "", body: draft.draft?.body || "", dirty: draft.dirty,
        busy: draft.busy || deleting, locked: deleting, error: operationError || draft.error, conflict: draft.conflict, saved: draft.saved, resetRevision: draft.resetRevision,
        onChange: draft.change, onSave: () => { if (!deleting && !backupOpen) void draft.save(); }, onReload: () => void reload(),
        onDiscard: () => { void beforeLeave.current(); }, onDelete: () => void deleteCurrent(), onBackups: () => { if (!draft.busy && !deleting) setBackupOpen(true); } }} />
  </WorkspaceChrome>{backupOpen && active && <BackupDialog date={logs.selection.date} onClose={() => setBackupOpen(false)} onRestored={acceptExternal}
    beforeRestore={() => confirm({ title: "恢复此版本？", message: draft.dirty ? "恢复将替换当前日块，并放弃未保存修改；写入前会保留现有文件。" : "恢复将替换当前日块，其他日期保持不变；写入前会保留现有文件。", confirmLabel: "恢复", tone: "danger" })} />}
    {confirmation && active && <ConfirmDialog {...confirmation} onConfirm={() => resolveConfirmation(true)} onCancel={() => resolveConfirmation(false)} />}</>;
}

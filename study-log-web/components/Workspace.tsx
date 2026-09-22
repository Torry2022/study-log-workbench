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
import { useFavorites } from "@/hooks/use-favorites";
import { FavoritesModule } from "./FavoritesModule";
import { FavoritesNavigation } from "./FavoritesNavigation";
import { useStats } from "@/hooks/use-stats";
import { useNotes } from "@/hooks/use-notes";
import { StudyStatsPage, StatsNavigation } from "./StudyStatsPage";
import { NotesModule } from "./NotesModule";
import { NotesNavigation } from "./NotesNavigation";
import { ExportMenu } from "./ExportMenu";
import { useExport } from "@/hooks/use-export";
import type { InternalLinkTarget } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { toEditableDayBody } from "@/lib/day-content";
import type { StatsEntry } from "@/lib/stats-types";
import type { WorkspaceMode } from "./LogReader";
import "@/app/editing-workspace.css";

export function Workspace() {
  const { active, logout } = useSession();
  const beforeLeave = useRef<() => Promise<boolean>>(async () => true);
  const logs = useLogWorkspace(active, beforeLeave);
  const { confirmation, confirm, resolveConfirmation } = useConfirmation();
  const notes = useNotes({ active, visible: logs.selection.view === "notes", onConfirm: confirm, routeNoteId: logs.selection.noteId, routeToken: logs.navigationRevision });
  const stats = useStats({ active, visible: logs.selection.view === "stats", onConfirm: confirm, routeMonth: logs.selection.statsMonth, onRouteMonthChange: logs.selectStatsMonth });
  const favorites = useFavorites(active);
  const acceptSaved = useCallback((day: DayEntry) => { logs.acceptSaved(day); void favorites.reload(); }, [logs.acceptSaved, favorites.reload]);
  const draft = useLogDraft(logs.day, active, acceptSaved);
  const logView = logs.selection.view === "log";
  const exporting = useExport({ active: active && (logView || logs.selection.view === "notes"), contextKey: logs.selection.view, date: logs.selection.date, logDirty: draft.dirty, notesDirty: notes.dirty, onConfirm: confirm });
  const [mode, setMode] = useState<WorkspaceMode>("preview");
  const { theme, preference, chooseTheme } = useTheme();
  const [reading, setReading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [missingFavorite, setMissingFavorite] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [returnNoteId, setReturnNoteId] = useState("");
  const navigationState = useRef({ active, revision: logs.navigationRevision });
  navigationState.current = { active, revision: logs.navigationRevision };
  const sourceNavigation = useRef(0);
  const [searchSelection, setSearchSelection] = useState<SearchSelection | null>(null);
  const clearSearch = useCallback(() => setSearchSelection(null), []);
  const selectDate = useCallback(async (date: string, heading = "") => {
    const accepted = await logs.selectDate(date, heading);
    if (accepted) { setSearchSelection(null); setMissingFavorite(""); }
    return accepted;
  }, [logs.selectDate]);
  beforeLeave.current = async () => {
    if (!active) return false;
    if (logs.selection.view === "notes") return notes.beforeLeave();
    if (logs.selection.view === "stats") return stats.beforeLeave();
    if (draft.busy || deleting || backupOpen) return false;
    if (!draft.dirty) return true;
    const accepted = await confirm({ title: "放弃未保存修改？", message: "当前日志有未保存修改，离开后将丢弃这些修改。", confirmLabel: "放弃修改", tone: "danger" });
    if (accepted) draft.reset();
    return accepted;
  };
  useEffect(() => { if (!active) { resolveConfirmation(false); setBackupOpen(false); } }, [active, resolveConfirmation]);
  useEffect(() => { setOperationError(""); }, [logs.selection.date]);
  useEffect(() => {
    if (!active || !logView) return;
    const save = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return;
      event.preventDefault(); if (!backupOpen && !deleting && (draft.dirty || (logs.day && !logs.day.exists))) void draft.save();
    };
    window.addEventListener("keydown", save);
    return () => window.removeEventListener("keydown", save);
  }, [active, logView, draft.dirty, draft.save, logs.day, backupOpen, deleting]);
  const reload = async () => { if (await beforeLeave.current()) { draft.reset(); logs.retry(); } };
  const exit = async () => {
    if (!(await beforeLeave.current())) return;
    setSessionError("");
    try { await logout(); clearSearchSessionHistory(); } catch { setSessionError("退出失败，请重试"); }
  };
  const acceptExternal = (day: DayEntry) => { draft.acceptExternal(day); acceptSaved(day); setOperationError(""); };
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
  const openStatsEntry = async (entry: StatsEntry) => {
    const attempt = ++sourceNavigation.current;
    const revision = navigationState.current.revision;
    setNavigationError("");
    try {
      const { day } = await requestJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(entry.date)}`);
      if (attempt !== sourceNavigation.current || !navigationState.current.active || navigationState.current.revision !== revision) return false;
      const heading = buildMarkdownOutline(toEditableDayBody(day.date, day.content)).filter(item => item.level === 3)[entry.headingIndex];
      const found = heading?.text === entry.rawHeading;
      if (!(await selectDate(entry.date, found ? heading.id : ""))) return false;
      setMode("preview"); setReading(false);
      if (!found) setNavigationError("统计来源已变化，已打开所属日期，请刷新统计。");
      return true;
    } catch (error) {
      if (attempt === sourceNavigation.current && navigationState.current.active && navigationState.current.revision === revision && !(error instanceof Error && error.name === "AbortError")) setNavigationError(error instanceof Error ? error.message : "读取统计来源失败");
      return false;
    }
  };
  const openNotesLogTarget = async (target: InternalLinkTarget, noteId: string) => {
    const attempt = ++sourceNavigation.current;
    if (!target.date) { setNavigationError("随记中的日志链接需要包含日期。"); return false; }
    const revision = navigationState.current.revision;
    setNavigationError("");
    try {
      const { day } = await requestJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(target.date)}`);
      if (attempt !== sourceNavigation.current || !navigationState.current.active || navigationState.current.revision !== revision) return false;
      if (!day.exists) { setNavigationError("未找到链接指向的日志日期。"); return false; }
      if (!(await selectDate(target.date, target.headingText))) return false;
      setReturnNoteId(noteId); setMode("preview"); setReading(false);
      return true;
    } catch (error) {
      if (attempt === sourceNavigation.current && navigationState.current.active && navigationState.current.revision === revision && !(error instanceof Error && error.name === "AbortError")) setNavigationError(error instanceof Error ? error.message : "读取日志来源失败");
      return false;
    }
  };
  return <><WorkspaceChrome active={active} months={logs.months} days={logs.days}
    view={logs.selection.view} onView={async view => { const accepted = await logs.selectView(view); if (accepted) { clearSearch(); setReading(false); if (view === "favorites") void favorites.reload(); } return accepted; }}
    moduleNavigation={onNavigate => logs.selection.view === "favorites" ? <FavoritesNavigation favorites={favorites} active={active} /> : logs.selection.view === "stats" ? <StatsNavigation stats={stats} onNavigate={onNavigate} /> : logs.selection.view === "notes" ? <NotesNavigation notes={notes} onNavigate={onNavigate} /> : null}
    selectedMonth={logs.selection.month} selectedDate={logs.selection.date}
    loading={logs.navigationLoading} error={logs.navigationError || sessionError} readingMode={reading && logView}
    theme={theme} themePreference={preference} onTheme={chooseTheme}
    onMonth={month => { clearSearch(); logs.selectMonth(month); }} onDate={selectDate} onRetry={logs.retry}
    onSearchChange={clearSearch} onSearchSelect={async result => { if (!(await selectDate(result.date))) return false; setMode("preview"); setReading(false); setSearchSelection(result); return true; }}
    onNewDate={date => { void logs.selectDate(date).then(accepted => { if (accepted) setMode("source"); }); }} onLogout={() => void exit()}>
    {navigationError && <div className="editor-navigation-status" role="alert">{navigationError}<button className="button secondary" type="button" onClick={() => setNavigationError("")}>关闭</button></div>}
    {(exporting.status || exporting.error || exporting.busy) && <div className="editor-navigation-status" role={exporting.error ? "alert" : "status"}>{exporting.error || exporting.status || "正在准备导出…"}{exporting.busy && <button className="button secondary" type="button" onClick={exporting.cancel}>取消导出</button>}</div>}
    {logView && returnNoteId && <div className="editor-navigation-status"><button className="button secondary" type="button" onClick={async () => { if (await logs.selectNote(returnNoteId)) { setReturnNoteId(""); setReading(false); } }}>返回随记</button></div>}
    <div className="workspace-view" hidden={!logView}><LogReader active={active && logView} favorites={favorites} exporting={exporting} day={logs.day} date={logs.selection.date} heading={logs.selection.heading}
      scrollTarget={logs.scrollTarget} navigationRevision={logs.navigationRevision} loading={logs.loading} error={logs.error} theme={theme}
      reading={reading} onReading={value => { if (value) setMode("preview"); setReading(value); }} onRetry={logs.retry} onNavigate={selectDate}
      search={searchSelection?.date === logs.selection.date ? searchSelection : null}
      editing={{ mode, onMode: setMode, documentDate: draft.draft?.date || "", body: draft.draft?.body || "", dirty: draft.dirty,
        busy: draft.busy || deleting, locked: deleting, error: operationError || draft.error || (missingFavorite === logs.selection.date ? "原收藏小节未找到，已打开所属日期。" : ""), conflict: draft.conflict, saved: draft.saved, resetRevision: draft.resetRevision,
        onChange: draft.change, onSave: () => { if (!deleting && !backupOpen) void draft.save(); }, onReload: () => void reload(),
        onDiscard: () => { void beforeLeave.current(); }, onDelete: () => void deleteCurrent(), onBackups: () => { if (!draft.busy && !deleting) setBackupOpen(true); } }} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "favorites"}><FavoritesModule favorites={favorites} active={active && logs.selection.view === "favorites"} onOpen={async (date, heading, missing) => { const accepted = await selectDate(date, heading); if (accepted) { setMode("preview"); setReading(false); if (missing) setMissingFavorite(date); } return accepted; }} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "stats"}><StudyStatsPage stats={stats} onOpenEntry={openStatsEntry} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "notes"}><NotesModule notes={notes} themeMode={theme} onOpenLogTarget={openNotesLogTarget} exportAction={<ExportMenu scopes={[{ scope: "notes", label: "全部随记" }]} onExport={exporting.run} busy={exporting.busy} disabled={!active} />} /></div>
  </WorkspaceChrome>{backupOpen && active && <BackupDialog date={logs.selection.date} onClose={() => setBackupOpen(false)} onRestored={acceptExternal}
    beforeRestore={() => confirm({ title: "恢复此版本？", message: draft.dirty ? "恢复将替换当前日块，并放弃未保存修改；写入前会保留现有文件。" : "恢复将替换当前日块，其他日期保持不变；写入前会保留现有文件。", confirmLabel: "恢复", tone: "danger" })} />}
    {confirmation && active && <ConfirmDialog {...confirmation} onConfirm={() => resolveConfirmation(true)} onCancel={() => resolveConfirmation(false)} />}</>;
}

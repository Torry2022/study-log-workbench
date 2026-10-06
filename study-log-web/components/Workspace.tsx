"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./AuthGate";
import { WorkspaceChrome } from "./WorkspaceChrome";
import { LogReader } from "./LogReader";
import { FeatureAvailability } from "./FeatureAvailability";
import { useLogWorkspace } from "@/hooks/use-log-workspace";
import { useTheme } from "@/hooks/use-theme";
import { useLogDraft } from "@/hooks/use-log-draft";
import { useConfirmation } from "@/hooks/use-confirmation";
import { ConfirmDialog } from "./ConfirmDialog";
import { BackupDialog } from "./BackupDialog";
import { requestJson, requestLogJson } from "@/lib/client-http";
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
import { useWriting } from "@/hooks/use-writing";
import { WritingPanel } from "./WritingPanel";
import { useHighlighting } from "@/hooks/use-highlighting";
import { HighlightPanel } from "./HighlightPanel";
import { HighlightReviewDialog } from "./HighlightReviewDialog";
import { useNoteCandidates } from "@/hooks/use-note-candidates";
import { NoteCandidateExtractor } from "./NoteCandidateExtractor";
import { AppFeedback } from "./AppFeedback";
import { useRag } from "@/hooks/use-rag";
import { RagWorkspace } from "./RagWorkspace";
import { RagHistorySidebar } from "./RagHistorySidebar";
import type { RagCitation } from "@/lib/rag-types";
import { CalendarDays, Lightbulb, Plus, Star, Tag, Tags, WandSparkles } from "lucide-react";
import type { InternalLinkTarget } from "./MarkdownPreview";
import { buildMarkdownOutline } from "@/lib/markdown-outline";
import { assertEditableDayBody, toEditableDayBody } from "@/lib/day-content";
import type { StatsEntry } from "@/lib/stats-types";
import type { WorkspaceMode } from "./LogReader";
import "@/app/editing-workspace.css";

export function Workspace() {
  const { active, logout } = useSession();
  const beforeLeave = useRef<() => Promise<boolean>>(async () => true);
  const logs = useLogWorkspace(active, beforeLeave);
  const { confirmation, confirm, resolveConfirmation } = useConfirmation();
  const rag = useRag({ active, visible: logs.selection.view === "qa", routeSessionId: logs.selection.sessionId, routeToken: logs.navigationRevision, onConfirm: confirm, onRoute: logs.replaceRagSession });
  const notes = useNotes({ active, visible: logs.selection.view === "notes", onConfirm: confirm, routeNoteId: logs.selection.noteId, routeToken: logs.navigationRevision });
  const extraction = useNoteCandidates({ active, visible: logs.selection.view === "notes", tags: notes.tags, onConfirm: confirm, onSaved: async () => { notes.clearFilters(); notes.clearSearch(); await notes.reload(); } });
  const notesWithExtraction = { ...notes, openNew: async () => { if (!(await extraction.beforeLeave())) return false; return notes.openNew(); } };
  const stats = useStats({ active, visible: logs.selection.view === "stats", onConfirm: confirm, routeMonth: logs.selection.statsMonth, onRouteMonthChange: logs.selectStatsMonth });
  const favorites = useFavorites(active);
  const acceptSaved = useCallback((day: DayEntry) => { logs.acceptSaved(day); void favorites.reload(); }, [logs.acceptSaved, favorites.reload]);
  const draft = useLogDraft(logs.day, active, acceptSaved);
  const logView = logs.selection.view === "log";
  const exporting = useExport({ active: active && (logView || logs.selection.view === "notes"), contextKey: logs.selection.view, date: logs.selection.date, logDirty: draft.dirty, notesDirty: notes.dirty, onConfirm: confirm });
  const [mode, setMode] = useState<WorkspaceMode>("preview");
  const [dayQuery, setDayQuery] = useState("");
  const [openAiRequest, setOpenAiRequest] = useState(0);
  const dayNeedle = dayQuery.trim().toLocaleLowerCase();
  const visibleDays = dayNeedle ? logs.days.filter(day => `${day.date} ${day.headings.join(" ")}`.toLocaleLowerCase().includes(dayNeedle)) : logs.days;
  const dayIndex = visibleDays.findIndex(day => day.date === logs.selection.date);
  const { theme, preference, chooseTheme } = useTheme();
  const [reading, setReading] = useState(false);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px)");
    const leaveDesktopReading = () => { if (mobile.matches) setReading(false); };
    leaveDesktopReading(); mobile.addEventListener("change", leaveDesktopReading);
    return () => mobile.removeEventListener("change", leaveDesktopReading);
  }, []);
  const [sessionError, setSessionError] = useState("");
  const [backupOpen, setBackupOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [missingFavorite, setMissingFavorite] = useState<string | null>(null);
  useEffect(() => {
    setMissingFavorite(current => current === logs.selection.date ? current : null);
  }, [logs.selection.date]);
  const [navigationError, setNavigationError] = useState("");
  const [returnNoteId, setReturnNoteId] = useState("");
  const [returnRag, setReturnRag] = useState<{ scroll: number } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"writing" | "highlighting">("writing");
  const writing = useWriting({ active, visible: logView, date: logs.selection.date, onConfirm: confirm, onApply: async (date, content) => {
    if (!active || !logView || draft.busy || deleting || backupOpen || logs.loading || draft.draft?.date !== date || logs.selection.date !== date) return false;
    const body = draft.draft.body ? `${draft.draft.body}\n\n${content}` : content;
    assertEditableDayBody(body);
    draft.replaceBody(body); setMode("source"); setReading(false); return true;
  } });
  const highlighting = useHighlighting({ active, visible: logView, date: logs.selection.date, content: draft.draft?.date === logs.selection.date ? draft.draft.body : "", onApply: async (date, original, content) => {
    if (!active || !logView || draft.busy || deleting || backupOpen || logs.loading || draft.draft?.date !== date || logs.selection.date !== date || draft.draft.body !== original) return false;
    assertEditableDayBody(content);
    draft.replaceBody(content); setMode("source"); setReading(false); return true;
  } });
  const navigationState = useRef({ active, revision: logs.navigationRevision });
  navigationState.current = { active, revision: logs.navigationRevision };
  const sourceNavigation = useRef(0);
  const [searchSelection, setSearchSelection] = useState<SearchSelection | null>(null);
  const clearSearch = useCallback(() => setSearchSelection(null), []);
  const selectDate = useCallback(async (date: string, heading = "") => {
    const accepted = await logs.selectDate(date, heading);
    if (accepted) { setSearchSelection(null); setMissingFavorite(null); }
    return accepted;
  }, [logs.selectDate]);
  const openLog = () => { void logs.selectView("log").then(accepted => { if (accepted) { clearSearch(); setReading(false); } }); };
  const selectSidebarDate = async (date: string, heading = "", headingIndex?: number) => {
    if (!heading) return selectDate(date);
    const attempt = ++sourceNavigation.current, revision = navigationState.current.revision;
    setNavigationError("");
    try {
      const { day } = await requestLogJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(date)}`);
      if (attempt !== sourceNavigation.current || !navigationState.current.active || revision !== navigationState.current.revision) return false;
      const target = headingIndex === undefined ? undefined : buildMarkdownOutline(toEditableDayBody(date, day.content)).filter(item => item.level === 3)[headingIndex];
      if (!(await selectDate(date, target?.id || heading))) return false;
      setMode("preview"); setReading(false); setDayQuery(""); return true;
    } catch (error) {
      if (attempt === sourceNavigation.current && navigationState.current.active && revision === navigationState.current.revision && !(error instanceof Error && error.name === "AbortError")) setNavigationError(error instanceof Error ? error.message : "读取日志小节失败");
      return false;
    }
  };
  beforeLeave.current = async () => {
    if (!active) return false;
    if (logs.selection.view === "qa") return rag.beforeLeave();
    if (logs.selection.view === "notes") return await extraction.beforeLeave() && await notes.beforeLeave();
    if (logs.selection.view === "stats") return stats.beforeLeave();
    if (draft.busy || deleting || backupOpen) return false;
    if (!draft.dirty && !writing.dirty && !writing.busy) return true;
    const accepted = await confirm({ title: "放弃未保存修改？", message: writing.dirty || writing.busy ? "离开将丢弃当前未保存的日志修改、AI材料与生成草稿，并取消进行中的操作。" : "当前日志有未保存修改，离开后将丢弃这些修改。", confirmLabel: "放弃修改", tone: "danger" });
    if (accepted && active) { draft.reset(); writing.discard(); }
    return accepted;
  };
  const discardLog = async () => {
    if (!active || draft.busy || deleting || backupOpen) return false;
    if (!draft.dirty) return true;
    const accepted = await confirm({ title: "放弃未保存修改？", message: "当前日志有未保存修改，继续将丢弃这些修改。AI材料与生成草稿会保留。", confirmLabel: "放弃修改", tone: "danger" });
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
  const reload = async () => { if (await discardLog()) { draft.reset(); logs.retry(); } };
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
  const openRagCitation = async (citation: RagCitation) => {
    const attempt = ++sourceNavigation.current, revision = navigationState.current.revision, scroll = window.scrollY;
    setNavigationError("");
    try {
      const { day } = await requestJson<{ day: DayEntry }>(`/api/logs/day?date=${encodeURIComponent(citation.date)}`);
      if (attempt !== sourceNavigation.current || !navigationState.current.active || navigationState.current.revision !== revision) return;
      if (!day.exists) { setNavigationError("引用的日志日期已不存在，回答中的原始片段仍可查看。"); return; }
      const headings = buildMarkdownOutline(toEditableDayBody(day.date, day.content)).filter(item => item.level === 3);
      const heading = citation.headingIndex === null ? null : headings[citation.headingIndex];
      const found = citation.headingIndex === null || heading?.text === citation.heading;
      if (!(await selectDate(citation.date, found ? heading?.id || "" : ""))) return;
      setReturnRag({ scroll }); setMode("preview"); setReading(false);
      if (!found) setNavigationError("引用标题已变化，已打开所属日期；请对照回答中的原始片段。");
    } catch (failure) {
      if (attempt === sourceNavigation.current && navigationState.current.active && navigationState.current.revision === revision) setNavigationError(failure instanceof Error ? failure.message : "读取引用失败");
    }
  };
  return <><WorkspaceChrome active={active} months={logs.months} days={logs.days}
    openAiRequest={openAiRequest}
    moduleSidebar={logs.selection.view === "favorites" ? { title: <><Star size={15} /><span>收藏导航</span></>, label: "筛选收藏", icon: <Star size={18} />, filtered: favorites.filters.group !== "all" || favorites.filters.month !== "all", onReset: () => favorites.filter({ group: "all", month: "all" }) }
      : logs.selection.view === "notes" ? { title: <><Lightbulb size={15} /><span>随记</span></>, label: "年份和标签", icon: <Tag size={18} />, filtered: notes.yearFilter !== "all" || notes.tagFilter !== "all", onReset: notes.clearFilters, railActionBefore: <button className="sidebar-rail-button" type="button" title="新建随记" aria-label="新建随记" disabled={notes.saving} onClick={() => void notesWithExtraction.openNew()}><Plus size={18} /></button> }
      : logs.selection.view === "stats" ? { title: "统计导航", label: "统计月份", icon: <CalendarDays size={18} />, filtered: Boolean(stats.months[0] && stats.selectedMonth !== stats.months[0].id), onReset: () => { if (stats.months[0]) void stats.changeMonth(stats.months[0].id); }, railAction: <button className="sidebar-rail-button" type="button" title="分类管理" aria-label="分类管理" onClick={stats.showManager}><Tags size={18} /></button> } : undefined}
    ragNavigation={({ collapsed, visible, onCollapse, onExpand, onNavigate }) => <RagHistorySidebar active={active} visible={logs.selection.view === "qa" && visible} collapsed={collapsed}
      sessions={rag.sessions} activeSessionId={rag.session?.id || ""} query={rag.query} loading={rag.loading} error={rag.historyError} onRetry={rag.retryHistory} generating={rag.generating || rag.saving || rag.initializing}
      onCollapse={onCollapse} onExpand={onExpand} onQueryChange={rag.setQuery} onNew={() => { void rag.newSession().then(accepted => { if (accepted) onNavigate(); }); }}
      onOpen={async id => { const accepted = await logs.selectRagSession(id); if (accepted) onNavigate(); return accepted; }} onRename={rag.rename} onDelete={rag.delete} />}
    inspectorTab={inspectorTab} onInspectorTab={setInspectorTab}
    inspector={inspectorTab === "writing" ? <WritingPanel writing={writing} themeMode={theme} /> : <HighlightPanel highlighting={highlighting} />}
    view={logs.selection.view} onView={async view => { const accepted = await logs.selectView(view); if (accepted) { clearSearch(); setReading(false); if (view === "favorites") void favorites.reload(); } return accepted; }}
    moduleNavigation={(onNavigate, filtersOnly) => logs.selection.view === "favorites" ? <FavoritesNavigation favorites={favorites} active={active} /> : logs.selection.view === "stats" ? <StatsNavigation stats={stats} filtersOnly={filtersOnly} onNavigate={onNavigate} /> : logs.selection.view === "notes" ? <NotesNavigation notes={notesWithExtraction} filtersOnly={filtersOnly} onNavigate={onNavigate} onExport={() => void exporting.run("notes")} exportBusy={exporting.busy} /> : null}
    selectedMonth={logs.selection.month} selectedDate={logs.selection.date} dayQuery={dayQuery} onDayQueryChange={setDayQuery}
    loading={logs.navigationLoading} error={logs.navigationError || sessionError} readingMode={reading && logView}
    theme={theme} themePreference={preference} onTheme={chooseTheme}
    onMonth={month => { clearSearch(); logs.selectMonth(month); }} onDate={selectSidebarDate} onRetry={logs.retry}
    onSearchChange={clearSearch} onSearchSelect={async result => { if (!(await selectDate(result.date))) return false; setMode("preview"); setReading(false); setSearchSelection(result); return true; }}
    onNewDate={date => { void logs.selectDate(date).then(accepted => { if (accepted) setMode("source"); }); }} onLogout={() => void exit()}>
    {navigationError && <AppFeedback message={navigationError} tone="error" onDismiss={() => setNavigationError("")} />}
    {(exporting.status || exporting.error || exporting.busy) && <AppFeedback message={exporting.error || exporting.status || "正在准备导出…"} tone={exporting.error ? "error" : exporting.status ? "warning" : "info"} onDismiss={exporting.dismiss} action={exporting.busy ? { label: "取消导出", onClick: exporting.cancel } : undefined} />}
    <div className="workspace-view" hidden={logs.selection.view !== "qa"}>
      {rag.error && <div className="editor-navigation-status" role="alert">{rag.error}<button className="button secondary" onClick={rag.clearError}>关闭</button><button className="button secondary" onClick={() => void rag.reloadSession()}>重新读取</button></div>}
      {(rag.saveError || rag.saving) && <div className="editor-navigation-status" role={rag.saveError ? "alert" : "status"}>{rag.saveError || "正在保存问答历史…"}{rag.saveError && <><button className="button secondary" disabled={rag.saving || !active} onClick={rag.retrySave}>重试保存</button><button className="button secondary" disabled={rag.saving || !active} onClick={() => void rag.reloadSession()}>放弃本地回答并重新读取</button></>}</div>}
      <RagWorkspace noLogs={!logs.navigationLoading && !logs.navigationError && !logs.months.length} onOpenLog={openLog} active={active} visible={logs.selection.view === "qa"} disabled={!rag.configured || rag.saving || Boolean(rag.saveError)} messages={rag.messages} initializing={rag.initializing}
        availability={rag.configurationError ? <FeatureAvailability title="问答服务尚未就绪" description="暂时无法提问，已有的问答记录仍可查看。" messages={[rag.configurationError]} onCheck={() => void rag.refreshConfiguration()} /> : undefined}
        question={rag.question} stage={rag.stage} generating={rag.generating} themeMode={theme} answerMode={rag.answerMode} focusRequestToken={rag.focusToken} sessionNavigationToken={rag.navigationToken}
        onQuestionChange={rag.setQuestion} onAnswerModeChange={rag.setAnswerMode} onSubmit={() => void rag.submit()} onStop={rag.stop} onRegenerate={() => void rag.regenerate()} onCitation={citation => void openRagCitation(citation)} />
    </div>
    <div className="workspace-view" hidden={!logView}><LogReader hasLogs={logs.months.length > 0} active={active && logView} favorites={favorites} exporting={exporting} day={logs.day} date={logs.selection.date} heading={logs.selection.heading}
      onOpenAi={() => setOpenAiRequest(value => value + 1)}
      onOpenFavorites={() => { void logs.selectView("favorites").then(accepted => { if (accepted) { clearSearch(); setReading(false); void favorites.reload(); } }); }}
      navigation={{ previousDate: dayIndex > 0 ? visibleDays[dayIndex - 1].date : null, nextDate: dayIndex >= 0 ? visibleDays[dayIndex + 1]?.date || null : null, showAdjacent: true,
        onReturnNotes: returnNoteId ? async () => { if (await logs.selectNote(returnNoteId)) { setReturnNoteId(""); setReading(false); } } : undefined,
        onReturnRag: returnRag ? async () => { const target = returnRag; if (await logs.selectView("qa")) { setReturnRag(null); requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: target.scroll, behavior: "auto" }))); } } : undefined }}
      scrollTarget={logs.scrollTarget} navigationRevision={logs.navigationRevision} loading={logs.loading} error={logs.error} theme={theme}
      reading={reading} onReading={value => { if (value) setMode("preview"); setReading(value); }} onRetry={logs.retry} onNavigate={selectDate}
      search={searchSelection?.date === logs.selection.date ? searchSelection : null}
      editing={{ mode, onMode: setMode, documentDate: draft.draft?.date || "", body: draft.draft?.body || "", dirty: draft.dirty,
        busy: draft.busy || deleting, locked: deleting, error: operationError || draft.error || (missingFavorite === logs.selection.date ? "原收藏小节未找到，已打开所属日期。" : ""), conflict: !operationError && draft.conflict, saved: draft.saved, resetRevision: draft.resetRevision,
        onChange: draft.change, onSave: () => { if (!deleting && !backupOpen) void draft.save(); }, onReload: () => void reload(), onDismissError: () => { setOperationError(""); setMissingFavorite(null); draft.dismissError(); },
        onDiscard: () => { void discardLog(); }, onDelete: () => void deleteCurrent(), onBackups: () => { if (!draft.busy && !deleting) setBackupOpen(true); } }} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "favorites"}><FavoritesModule onOpenLog={openLog} favorites={favorites} active={active && logs.selection.view === "favorites"} onOpen={async (date, heading, missing) => { const accepted = await selectDate(date, heading); if (accepted) { setMode("preview"); setReading(false); if (missing) setMissingFavorite(date); } return accepted; }} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "stats"}><StudyStatsPage onOpenLog={openLog} stats={stats} onOpenEntry={openStatsEntry} /></div>
    <div className="workspace-view" hidden={logs.selection.view !== "notes"}><NotesModule onOpenLog={openLog} notes={notesWithExtraction} themeMode={theme} onOpenLogTarget={openNotesLogTarget}
      extraction={extraction.open ? <NoteCandidateExtractor extraction={extraction} /> : undefined}
      extractAction={<button type="button" aria-label="AI提取" title="AI提取" className={`button secondary notes-ai-extract${extraction.open ? " active" : ""}`} disabled={!active || notes.busy || extraction.busy === "save"} onClick={async () => { if (extraction.open) await extraction.beforeLeave(); else if (await notes.beforeLeave()) extraction.begin(); }}><WandSparkles size={15} /><span>AI提取</span></button>}
      exportAction={<ExportMenu scopes={[{ scope: "notes", label: "全部随记", disabled: !notes.notes.length }]} onExport={exporting.run} busy={exporting.busy} disabled={!active || !notes.notes.length} />} /></div>
  </WorkspaceChrome>{backupOpen && active && <BackupDialog date={logs.selection.date} onClose={() => setBackupOpen(false)} onRestored={acceptExternal}
    beforeRestore={() => confirm({ title: "恢复此版本？", message: draft.dirty ? "恢复将替换当前日块，并放弃未保存修改；写入前会保留现有文件。" : "恢复将替换当前日块，其他日期保持不变；写入前会保留现有文件。", confirmLabel: "恢复", tone: "danger" })} />}
    <HighlightReviewDialog highlighting={highlighting} />
    {confirmation && active && <ConfirmDialog {...confirmation} onConfirm={() => resolveConfirmation(true)} onCancel={() => resolveConfirmation(false)} />}</>;
}

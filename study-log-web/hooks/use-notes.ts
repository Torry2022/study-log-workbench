"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { buildFacets, draftFingerprint, emptyDraft, filterNotes, mergeSavedNote, noteToDraft, parseSources, parseTags, type NoteDraft } from "@/lib/notes-view";
import type { StudyNote, StudyNotesPayload } from "@/lib/notes-types";
import { compareNoteUpdates } from "@/lib/note-order";
import { useNotesInsertion } from "./use-notes-insertion";

interface Options {
  active: boolean; visible: boolean;
  routeNoteId?: string; routeToken?: number;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
}
export type NotesController = ReturnType<typeof useNotes>;

export function useNotes({ active, visible, routeNoteId = "", routeToken = 0, onConfirm }: Options) {
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const current = useRef(draft);
  const baseline = useRef(draftFingerprint(draft));
  const editor = useRef(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<AbortController | null>(null);
  const confirming = useRef(false);
  const live = useRef({ active, visible, onConfirm }); live.current = { active, visible, onConfirm };
  const listScroll = useRef(0);
  const [yearFilter, setYearFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [focusedNoteId, setFocusedNoteId] = useState("");
  const [focusRevision, setFocusRevision] = useState(0);
  const handledRoute = useRef("");
  const insertions = useNotesInsertion({ active: active && visible && editorOpen, revision,
    getDraft: () => current.current, getRevision: () => generation.current, updateDraft });
  const dirty = editorOpen && draftFingerprint(draft) !== baseline.current;
  const busy = saving || insertions.busy;
  function isBusy() { return Boolean(writing.current) || confirming.current || insertions.isBusy(); }
  function updateDraft(patch: Partial<NoteDraft>) {
    insertions.track(patch);
    current.current = { ...current.current, ...patch }; setDraft(current.current); setMessage("");
  }
  function setEditor(next: NoteDraft, open: boolean) {
    insertions.cancelUpload();
    generation.current++; setRevision(generation.current);
    current.current = next; baseline.current = draftFingerprint(next); editor.current = open;
    setDraft(next); setEditorOpen(open); setConflict(false); setError("");
  }
  const reload = useCallback(async (): Promise<StudyNotesPayload | null> => {
    if (!live.current.active || writing.current) return null;
    reading.current?.abort(); const controller = new AbortController(); reading.current = controller;
    setLoading(true); setLoadError("");
    try {
      const payload = await requestJson<StudyNotesPayload>("/api/notes", { signal: controller.signal });
      if (controller.signal.aborted || !live.current.active) return null;
      setNotes(payload.notes); setLoaded(true); return payload;
    } catch (failure) {
      if (!controller.signal.aborted && live.current.active) setLoadError(failure instanceof Error ? failure.message : "加载随记失败");
      return null;
    } finally {
      if (reading.current === controller) reading.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && visible) void reload();
    return () => {
      reading.current?.abort(); writing.current?.abort(); writing.current = null;
      confirming.current = false; setSaving(false);
    };
  }, [active, visible, reload]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!active || !visible || !editorOpen) return;
    const save = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault(); void saveDraft();
    };
    window.addEventListener("keydown", save); return () => window.removeEventListener("keydown", save);
  });

  async function confirmDiscard(message = "当前随记有未保存修改，是否放弃？") {
    if (!live.current.active || confirming.current) return false;
    if (writing.current) { setError("请等待当前随记操作完成后再离开。"); return false; }
    if (!editor.current || (draftFingerprint(current.current) === baseline.current && !insertions.isBusy())) return true;
    confirming.current = true;
    const token = generation.current;
    try {
      const result = await live.current.onConfirm({ title: "放弃未保存修改？", message: insertions.isBusy() ? `${message} 正在上传的图片将取消插入。` : message, confirmLabel: "放弃", tone: "danger" });
      return result && live.current.active && token === generation.current;
    } finally { confirming.current = false; }
  }
  async function beforeLeave() {
    if (!(await confirmDiscard())) return false;
    if (editor.current) setEditor(emptyDraft(), false);
    return true;
  }
  function restoreListScroll() {
    const top = listScroll.current;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (live.current.active && live.current.visible && !editor.current) window.scrollTo({ top, behavior: "auto" }); }));
  }
  async function openNew() {
    if (!(await confirmDiscard())) return false;
    listScroll.current = window.scrollY; setEditor(emptyDraft(), true); setMessage("");
    requestAnimationFrame(() => { if (live.current.active && live.current.visible) { window.scrollTo({ top: 0, behavior: "auto" }); insertions.bodyRef.current?.focus(); } });
    return true;
  }
  async function openEdit(note: StudyNote) {
    if (editor.current && current.current.id === note.id) return true;
    if (!(await confirmDiscard())) return false;
    listScroll.current = window.scrollY; setEditor(noteToDraft(note), true); setMessage("");
    requestAnimationFrame(() => { if (live.current.active && live.current.visible) window.scrollTo({ top: 0, behavior: "auto" }); });
    return true;
  }
  async function closeEditor() {
    if (!(await beforeLeave())) return false;
    restoreListScroll(); return true;
  }
  function replaceNote(note: StudyNote) { setNotes(items => [note, ...items.filter(item => item.id !== note.id)].sort(compareNoteUpdates)); }
  async function saveDraft() {
    if (!live.current.active || !live.current.visible || !editor.current || isBusy() || conflict) return false;
    const submitted = { ...current.current }, token = generation.current;
    if (!submitted.body.trim()) { setError("请先填写随记正文"); return false; }
    reading.current?.abort(); setLoading(false);
    const controller = new AbortController(); writing.current = controller;
    setSaving(true); setError(""); setMessage("");
    try {
      const payload = { id: submitted.id || undefined, title: submitted.title, body: submitted.body, insight: submitted.insight,
        sources: parseSources(submitted.sourcesText), tags: parseTags(submitted.tagsText), recordedAt: submitted.recordedAt, baseVersion: submitted.baseVersion };
      const { note } = await requestJson<{ note: StudyNote }>("/api/notes", { method: submitted.id ? "PATCH" : "POST", body: JSON.stringify(payload), signal: controller.signal });
      if (controller.signal.aborted || token !== generation.current || !live.current.active) return false;
      replaceNote(note);
      const merged = mergeSavedNote(submitted, current.current, note);
      if (merged.keepEditor) {
        current.current = merged.draft; baseline.current = merged.baseline; setDraft(merged.draft);
        setMessage("已保存提交时的内容，后续修改仍在编辑器中。");
      } else { setEditor(emptyDraft(), false); restoreListScroll(); setMessage(submitted.id ? "随记已更新" : "随记已保存"); }
      return true;
    } catch (failure) {
      if (!controller.signal.aborted && live.current.active) {
        setError(failure instanceof Error ? failure.message : "保存随记失败，请重试");
        setConflict(failure instanceof ApiRequestError && failure.status === 409);
      }
      return false;
    } finally { if (writing.current === controller) { writing.current = null; setSaving(false); } }
  }
  async function reloadDraft() {
    if (!editor.current || !current.current.id || !(await confirmDiscard("重新读取会放弃当前草稿，请先保留需要的内容。是否继续？"))) return;
    const id = current.current.id, token = generation.current;
    const payload = await reload();
    if (!payload || token !== generation.current || !live.current.active) return;
    const note = payload.notes.find(item => item.id === id);
    if (!note) { setError("该随记已被删除，当前草稿已保留。"); return; }
    setEditor(noteToDraft(note), true);
  }
  async function deleteNote(note: StudyNote) {
    if (!live.current.active || isBusy() || confirming.current) return false;
    confirming.current = true;
    const token = generation.current;
    let accepted = false;
    try { accepted = await live.current.onConfirm({ title: "删除这条随记？", message: "删除后可从写入前备份中恢复。", confirmLabel: "删除", tone: "danger" }); }
    finally { confirming.current = false; }
    if (!accepted || !live.current.active || token !== generation.current || isBusy()) return false;
    reading.current?.abort(); setLoading(false);
    const controller = new AbortController(); writing.current = controller; setSaving(true); setError("");
    try {
      await requestJson("/api/notes", { method: "DELETE", body: JSON.stringify({ id: note.id, baseVersion: note.version }), signal: controller.signal });
      if (controller.signal.aborted || !live.current.active) return false;
      setNotes(items => items.filter(item => item.id !== note.id));
      if (current.current.id === note.id) setEditor(emptyDraft(), false);
      setMessage("随记已删除"); return true;
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "删除随记失败，请重试"); return false; }
    finally { if (writing.current === controller) { writing.current = null; setSaving(false); } }
  }

  useEffect(() => {
    const route = `${routeNoteId}:${routeToken}`;
    if (!active || !visible || !loaded || loading || loadError || (reading.current && !reading.current.signal.aborted) || !routeNoteId || handledRoute.current === route) return;
    handledRoute.current = route;
    let cancelled = false;
    void (async () => {
      if (!notes.some(note => note.id === routeNoteId)) { setError("链接中的随记不存在或不可访问"); return; }
      if (!(await confirmDiscard()) || cancelled) return;
      if (editor.current) setEditor(emptyDraft(), false);
      if (!filterNotes(notes, yearFilter, tagFilter, submittedQuery).some(note => note.id === routeNoteId)) {
        setYearFilter("all"); setTagFilter("all"); setQuery(""); setSubmittedQuery("");
      }
      setExpandedIds(items => new Set(items).add(routeNoteId)); setFocusedNoteId(routeNoteId); setFocusRevision(value => value + 1);
    })();
    return () => { cancelled = true; };
    // Each accepted incoming route is handled once; refreshes must not close drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, visible, loaded, loading, loadError, routeNoteId, routeToken]);

  const years = useMemo(() => buildFacets(notes, "year"), [notes]);
  const tags = useMemo(() => buildFacets(notes, "tags"), [notes]);
  const visibleNotes = useMemo(() => filterNotes(notes, yearFilter, tagFilter, submittedQuery), [notes, yearFilter, tagFilter, submittedQuery]);
  return { active, visible, notes, visibleNotes, years, tags, loaded, loading, loadError, error, message, conflict,
    saving, busy, dirty, editorOpen, draft, revision, insertions, yearFilter, tagFilter, query, submittedQuery,
    setYearFilter, setTagFilter, setQuery, submitSearch: () => setSubmittedQuery(query.trim()),
    clearSearch: () => { setQuery(""); setSubmittedQuery(""); }, clearFilters: () => { setYearFilter("all"); setTagFilter("all"); },
    expandedIds, focusedNoteId, focusRevision, toggleExpanded: (id: string) => setExpandedIds(items => { const next = new Set(items); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    reload, reloadNotes: reload, beforeLeave, openNew, openEdit, closeEditor, updateDraft, saveDraft, deleteNote, reloadDraft };
}

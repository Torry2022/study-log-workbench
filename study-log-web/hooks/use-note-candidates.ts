"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import type { StudyNoteCandidate, StudyNoteCandidateResult } from "@/lib/note-candidates";
import type { ExtractedDocument } from "@/lib/upload-extract";
import type { BatchStudyNoteInput, StudyNote, StudyNoteFacet } from "@/lib/notes-types";
import { localDateTimeInput, parseSources, parseTags } from "@/lib/notes-view";

type CandidateDraft = StudyNoteCandidate & { selected: boolean; sourcesText: string; tagsText: string; newTagsConfirmed: boolean };
interface Options {
  active: boolean; visible: boolean; tags: StudyNoteFacet[];
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
  onSaved: () => void | Promise<unknown>;
}
interface Capabilities {
  features: { aiNoteExtraction?: { supported: boolean; configured: boolean } };
  aiConfiguration?: { provider: { issues: Array<{ message: string }> }; templates: { extraction?: { issue?: { message: string } } } };
}
const tagKey = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase();
export type NoteCandidatesController = ReturnType<typeof useNoteCandidates>;

export function useNoteCandidates(options: Options) {
  const live = useRef(options); live.current = options;
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [candidates, setCandidates] = useState<CandidateDraft[]>([]);
  const [documents, setDocuments] = useState<StudyNoteCandidateResult["documents"]>([]);
  const [recordedAt, setRecordedAt] = useState(localDateTimeInput);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"extract" | "save" | null>(null);
  const [retrySave, setRetrySave] = useState(false);
  const savingSnapshot = useRef<BatchStudyNoteInput[] | null>(null);
  const request = useRef<AbortController | null>(null);
  const confirming = useRef(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const configuration = useRef<AbortController | null>(null);
  const [configurationError, setConfigurationError] = useState("");
  const dirty = open && Boolean(files.length || candidates.length || busy || retrySave);
  const configured = Boolean(capabilities?.features.aiNoteExtraction?.supported && capabilities.features.aiNoteExtraction.configured);
  const configurationMessages = !capabilities ? [] : [
    ...capabilities.aiConfiguration?.provider.issues.map(issue => issue.message) || [],
    ...capabilities.aiConfiguration?.templates.extraction?.issue ? [capabilities.aiConfiguration.templates.extraction.issue.message] : []
  ];
  const locked = Boolean(busy || retrySave);
  const refreshConfiguration = useCallback(async () => {
    if (!live.current.active) return;
    configuration.current?.abort(); const controller = new AbortController(); configuration.current = controller;
    setConfigurationError("");
    try {
      const payload = await requestJson<Capabilities>("/api/capabilities", { signal: controller.signal });
      if (!controller.signal.aborted && live.current.active) setCapabilities(payload);
    } catch (failure) { if (!controller.signal.aborted) setConfigurationError(failure instanceof Error ? failure.message : "读取配置失败"); }
  }, []);
  function cancel() { request.current?.abort(); request.current = null; setBusy(null); setStatus(""); }
  function discard() { cancel(); savingSnapshot.current = null; setRetrySave(false); setFiles([]); setCandidates([]); setDocuments([]); setWarnings([]); setError(""); setModel(""); setOpen(false); }
  useEffect(() => {
    if (options.active) setError(value => value === "登录已过期，请重新登录" ? "" : value);
    if (options.active && open) void refreshConfiguration();
    return () => configuration.current?.abort();
  }, [options.active, open, refreshConfiguration]);
  useEffect(() => () => { request.current?.abort(); request.current = null; setBusy(null); setStatus(""); }, [options.active, options.visible]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function beforeLeave() {
    if (!live.current.active || confirming.current || busy === "save") return false;
    if (!open) return true;
    if (dirty) {
      confirming.current = true;
      const accepted = await live.current.onConfirm({ title: "放弃随记提取？", message: retrySave ? "本次保存结果尚未确认。离开会丢弃当前候选；已提交的记录可能已保存，可先重试保存核对结果。" : "离开将丢弃所选材料与未保存候选，并取消提取。", confirmLabel: "放弃提取", tone: "danger" });
      confirming.current = false;
      if (!accepted || !live.current.active) return false;
    }
    discard(); return true;
  }
  function begin() { if (!live.current.active || !live.current.visible) return; setRecordedAt(localDateTimeInput()); setOpen(true); }
  function addFiles(incoming: File[]) {
    if (locked) return;
    const next = [...files], problems: string[] = [];
    for (const file of incoming) {
      if (!/\.(txt|md|markdown|pdf|docx|pptx)$/i.test(file.name)) { problems.push(`${file.name}：不支持此格式`); continue; }
      if (!file.size || file.size > 20 * 1024 * 1024) { problems.push(`${file.name}：文件须大于零且不超过 20 MiB`); continue; }
      if (next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
      if (next.length >= 5) { problems.push("每次最多选择 5 个文件"); break; }
      next.push(file);
    }
    setFiles(next); setError(problems.join("；"));
  }
  function newTags(candidate: CandidateDraft) { const existing = new Set(live.current.tags.map(item => tagKey(item.value))); return parseTags(candidate.tagsText).filter(tag => !existing.has(tagKey(tag))); }
  function update(id: string, patch: Partial<CandidateDraft>) { if (!locked) setCandidates(items => items.map(item => item.id === id ? { ...item, ...patch } : item)); }
  async function extract() {
    if (!configured || !live.current.active || !live.current.visible || !files.length || locked || request.current || confirming.current) return;
    if (candidates.length) {
      confirming.current = true;
      const accepted = await live.current.onConfirm({ title: "重新提取候选？", message: "成功后会替换当前候选及其中的修改；失败仍保留当前候选。", confirmLabel: "重新提取" });
      confirming.current = false; if (!accepted || !live.current.active) return;
    }
    const controller = new AbortController(); request.current = controller; setBusy("extract"); setError("");
    try {
      const extracted: ExtractedDocument[] = [], problems: string[] = [];
      for (const [index, file] of files.entries()) {
        controller.signal.throwIfAborted(); setStatus(`正在解析 ${index + 1}/${files.length}：${file.name}`);
        try {
          const form = new FormData(); form.append("file", file);
          const payload = await requestJson<{ document: ExtractedDocument }>("/api/materials/extract", { method: "POST", body: form, signal: controller.signal });
          extracted.push(payload.document);
        } catch (failure) {
          if (controller.signal.aborted || (failure instanceof ApiRequestError && failure.status === 401)) throw failure;
          problems.push(`${file.name}：${failure instanceof Error ? failure.message : "解析失败"}`);
        }
      }
      if (!extracted.length) throw new Error(problems.join("；") || "没有可提取的材料");
      controller.signal.throwIfAborted(); setStatus("正在生成随记候选…");
      const { result } = await requestJson<{ result: StudyNoteCandidateResult }>("/api/notes/candidates", { method: "POST", body: JSON.stringify({ documents: extracted }), signal: controller.signal });
      if (controller.signal.aborted || !live.current.active || !live.current.visible) return;
      setCandidates(result.candidates.map(item => ({ ...item, selected: true, sourcesText: item.sources.join("\n"), tagsText: item.tags.join("、"), newTagsConfirmed: false })));
      setDocuments(result.documents); setWarnings([...problems, ...result.warnings]); setModel(result.model);
      setStatus(result.candidates.length ? "请逐项核对候选、原文依据与新增标签后保存。" : "这次材料中没有适合保存为随记的内容。");
    } catch (failure) { if (!controller.signal.aborted && live.current.active) setError(failure instanceof Error ? failure.message : "提取失败，已有候选保留"); }
    finally { if (request.current === controller) { request.current = null; setBusy(null); } }
  }
  async function save() {
    if (!live.current.active || !live.current.visible || request.current || confirming.current) return;
    if (!savingSnapshot.current) {
      const selected = candidates.filter(item => item.selected);
      if (!selected.length) { setError("请先选择候选"); return; }
      if (selected.some(item => !item.body.trim())) { setError("选中的候选正文不能为空"); return; }
      if (selected.some(item => newTags(item).length && !item.newTagsConfirmed)) { setError("请先确认选中候选的新增标签"); return; }
      savingSnapshot.current = selected.map(item => ({ clientId: item.id, title: item.title, body: item.body, insight: item.insight, sources: parseSources(item.sourcesText), tags: parseTags(item.tagsText), recordedAt }));
      setRetrySave(true);
    }
    const controller = new AbortController(); request.current = controller; setBusy("save"); setError("");
    try {
      const submitted = savingSnapshot.current;
      const result = await requestJson<{ notes?: StudyNote[] }>("/api/notes/batch", { method: "POST", body: JSON.stringify({ notes: submitted }), signal: controller.signal });
      if (controller.signal.aborted || !live.current.active || !live.current.visible) return;
      if (!Array.isArray(result.notes) || result.notes.length !== submitted.length || result.notes.some((note, index) => !note || note.id !== submitted[index].clientId.toLowerCase() || typeof note.version !== "string" || !note.version)) throw new Error("保存结果尚未确认，请重试同一批次");
      discard(); await live.current.onSaved();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 400) { savingSnapshot.current = null; setRetrySave(false); }
      if (!controller.signal.aborted && live.current.active) setError(failure instanceof Error ? failure.message : "保存结果尚未确认，请重试同一批次");
    } finally { if (request.current === controller) { request.current = null; setBusy(null); } }
  }
  return { open, files, candidates, documents, recordedAt, warnings, model, error, status, busy, dirty, locked, retrySave, configured,
    configurationError, configurationMessages, refreshConfiguration, begin, beforeLeave, addFiles, extract, save, cancel,
    removeFile: (index: number) => { if (!locked) setFiles(items => items.filter((_, position) => position !== index)); },
    update, newTags, setRecordedAt: (value: string) => { if (!locked) setRecordedAt(value); },
    selectAll: (selected: boolean) => { if (!locked) setCandidates(items => items.map(item => ({ ...item, selected }))); },
    remove: (id: string) => { if (!locked) setCandidates(items => items.filter(item => item.id !== id)); } };
}

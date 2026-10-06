"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-http";
import { imageExtension, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT, type UploadedAsset } from "@/lib/asset-upload-rules";
import { mapNoteInsertion, type NoteDraft, type NoteInsertion } from "@/lib/notes-view";
import { markdownChange, type MarkdownEdit } from "@/lib/markdown-edit";

type Field = "body" | "insight";
interface Options {
  active: boolean; revision: number;
  getDraft: () => NoteDraft; getRevision: () => number;
  updateDraft: (patch: Partial<NoteDraft>) => void;
}
export function useNotesInsertion(options: Options) {
  const live = useRef(options); live.current = options;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const insightRef = useRef<HTMLTextAreaElement>(null);
  const activeField = useRef<Field>("body");
  const composing = useRef(false);
  const pending = useRef<{ range: NoteInsertion; controller: AbortController; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const [link, setLink] = useState<{ range: NoteInsertion; text: string; alias: string; revision: number } | null>(null);
  const textarea = (field: Field) => field === "body" ? bodyRef.current : insightRef.current;
  useEffect(() => {
    setLink(null); setBusy(false); setStatus(""); setFailed(false);
    return () => { pending.current?.controller.abort(); pending.current = null; };
  }, [options.active, options.revision]);

  function cancelUpload() { pending.current?.controller.abort(); pending.current = null; setBusy(false); setStatus(""); }
  function range(field = activeField.current): NoteInsertion | null {
    const input = textarea(field);
    return input ? { field, from: input.selectionStart, to: input.selectionEnd, valid: true } : null;
  }
  function focus(field: Field, from: number, to = from) {
    const revision = live.current.getRevision();
    requestAnimationFrame(() => {
      const input = textarea(field);
      if (!live.current.active || live.current.getRevision() !== revision || !input?.isConnected || input.closest("[inert]")) return;
      input.focus(); input.setSelectionRange(from, to);
    });
  }
  function insert(selection: NoteInsertion, text: string, selectedFrom = text.length, selectedTo = selectedFrom) {
    if (!selection.valid || !live.current.active) return false;
    const value = live.current.getDraft()[selection.field];
    live.current.updateDraft({ [selection.field]: value.slice(0, selection.from) + text + value.slice(selection.to) });
    focus(selection.field, selection.from + selectedFrom, selection.from + selectedTo);
    return true;
  }
  function track(patch: Partial<NoteDraft>) {
    const upload = pending.current;
    if (upload && typeof patch[upload.range.field] === "string") upload.range = mapNoteInsertion(upload.range, live.current.getDraft()[upload.range.field], patch[upload.range.field]!);
  }
  function format(command: MarkdownEdit) {
    if (!live.current.active || busy || composing.current) return;
    const field = activeField.current;
    const input = textarea(field);
    if (!input) return;
    const change = markdownChange(input.value, input.selectionStart, input.selectionEnd, command);
    input.focus(); input.setSelectionRange(change.from, change.to);
    // Native insertion keeps textarea undo history; assigning value would erase it.
    if (!document.execCommand("insertText", false, change.insert)) {
      setFailed(true); setStatus("当前浏览器未能应用格式，请使用 Markdown 语法输入。"); return;
    }
    live.current.updateDraft({ [field]: input.value });
    input.setSelectionRange(change.anchor, change.head);
  }
  function openInternalLink() {
    const selection = range(); if (!selection || busy) return;
    const text = live.current.getDraft()[selection.field];
    setLink({ range: selection, text, alias: text.slice(selection.from, selection.to), revision: live.current.getRevision() });
  }
  function insertInternalLink(markdown: string) {
    if (!link) return;
    if (link.revision === live.current.getRevision() && live.current.getDraft()[link.range.field] === link.text) insert(link.range, markdown);
    else { setFailed(true); setStatus("插入位置已变化，请重新选择内部链接位置。"); }
    setLink(null);
  }
  async function uploadFiles(files: File[], field = activeField.current) {
    if (!live.current.active || pending.current || !files.length) return;
    setFailed(false); setStatus("");
    if (files.length > MAX_IMAGE_COUNT || files.some(file => !imageExtension(file) || !file.size || file.size > MAX_IMAGE_BYTES)) {
      setFailed(true); setStatus("请选择不超过 10 张 PNG、JPEG、WebP、GIF、BMP 或 SVG 图片，每张不超过 20 MiB。"); return;
    }
    const selected = range(field); if (!selected) return;
    const operation = { range: selected, controller: new AbortController(), revision: live.current.getRevision() };
    pending.current = operation; setBusy(true); setStatus("正在上传图片…");
    try {
      const form = new FormData(); files.forEach(file => form.append("file", file));
      form.append("scope", "notes"); form.append("year", live.current.getDraft().recordedAt.slice(0, 4));
      const payload = await requestJson<{ assets: UploadedAsset[] }>("/api/assets/upload", { method: "POST", body: form, signal: operation.controller.signal });
      if (pending.current !== operation || operation.controller.signal.aborted || !live.current.active || operation.revision !== live.current.getRevision()) return;
      if (!operation.range.valid) { setFailed(true); setStatus("上传期间原选区已修改，未插入图片。请重新选择位置后上传。"); return; }
      const value = live.current.getDraft()[field], { from, to } = operation.range;
      const before = value.slice(0, from), after = value.slice(to);
      const markdown = `${before && !before.endsWith("\n") ? "\n" : ""}${payload.assets.map(asset => asset.markdown).join("\n")}${after && !after.startsWith("\n") ? "\n" : ""}`;
      insert(operation.range, markdown);
      setStatus(`已插入 ${payload.assets.length} 张图片，保存随记后生效`);
    } catch (error) {
      if (pending.current === operation && !operation.controller.signal.aborted) { setFailed(true); setStatus(error instanceof Error ? error.message : "图片上传失败，请重试"); }
    } finally {
      if (pending.current === operation) { pending.current = null; setBusy(false); }
    }
  }
  return { bodyRef, insightRef, busy, isBusy: () => Boolean(pending.current), status, failed, link,
    cancelUpload, closeLink: () => setLink(null), insertInternalLink, setActiveField: (field: Field) => { activeField.current = field; },
    format, setComposing: (value: boolean) => { composing.current = value; }, openInternalLink, uploadFiles, track };
}

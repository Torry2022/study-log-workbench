"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { ExternalChange } from "@uiw/react-codemirror";
import { requestJson } from "@/lib/client-http";
import { imageExtension, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT, type UploadedAsset } from "@/lib/asset-upload-rules";
import { insertAtRange, mapInsertion, type InsertionRange } from "@/lib/editor-insertion";

interface Pending { view: EditorView; range: InsertionRange; controller: AbortController }

export function useEditorAttachments(date: string, active: boolean, resetRevision: number, editor: () => EditorView | null) {
  const pending = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setStatus(""); setFailed(false); setBusy(false);
    return () => { pending.current?.controller.abort(); pending.current = null; };
  }, [date, active, resetRevision]);

  function update(value: ViewUpdate) {
    const current = pending.current;
    if (!current || current.view !== value.view || !value.docChanged) return;
    // Discard/reload is a controlled document reset, not another user edit.
    if (value.transactions.some(transaction => transaction.annotation(ExternalChange))) {
      current.controller.abort(); pending.current = null; setBusy(false); setStatus(""); return;
    }
    current.range = mapInsertion(current.range, value.changes);
  }

  async function upload(files: File[]) {
    const view = editor();
    if (!active || !view || pending.current || !files.length) return;
    setFailed(false); setStatus("");
    if (files.length > MAX_IMAGE_COUNT || files.some(file => !imageExtension(file) || !file.size || file.size > MAX_IMAGE_BYTES)) {
      setFailed(true); setStatus("请选择不超过 10 张 PNG、JPEG、WebP、GIF、BMP 或 SVG 图片，每张不超过 20 MiB。"); return;
    }
    const selection = view.state.selection.main;
    const operation: Pending = { view, range: { from: selection.from, to: selection.to, valid: true }, controller: new AbortController() };
    pending.current = operation; setBusy(true); setStatus("正在上传图片…");
    try {
      const form = new FormData();
      files.forEach(file => form.append("file", file));
      const result = await requestJson<{ assets: UploadedAsset[] }>("/api/assets/upload", { method: "POST", body: form, signal: operation.controller.signal });
      if (pending.current !== operation || editor() !== view) return;
      if (!insertAtRange(view, operation.range, result.assets.map(asset => asset.markdown).join("\n"), true)) {
        setFailed(true); setStatus("上传期间原选区已修改，未插入图片。请重新选择插入位置后上传。"); return;
      }
      setStatus(`已插入 ${result.assets.length} 张图片，保存日志后生效`);
    } catch (error) {
      if (pending.current !== operation || operation.controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setFailed(true); setStatus(error instanceof Error ? error.message : "图片上传失败，请重试");
    } finally {
      if (pending.current === operation) { pending.current = null; setBusy(false); }
    }
  }
  return { busy, status, failed, upload, update };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";
import { requestDownload, workspaceRequestSignal } from "@/lib/client-http";
import type { ExportScope } from "@/lib/export-store";

export type { ExportScope } from "@/lib/export-store";

type ExportOptions = {
  active: boolean;
  date?: string | null;
  contextKey?: string;
  logDirty?: boolean;
  notesDirty?: boolean;
  onConfirm: (options: ConfirmationOptions) => Promise<boolean>;
};

export function useExport(options: ExportOptions) {
  const latest = useRef(options);
  latest.current = options;
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  }, []);
  useEffect(() => {
    cancel();
    setStatus("");
    setError("");
    return () => { pending.current?.abort(); pending.current = null; };
  }, [options.active, options.date, options.contextKey, cancel]);

  const run = useCallback(async (scope: ExportScope): Promise<boolean> => {
    const current = latest.current;
    if (!current.active || pending.current) return false;
    if ((scope === "day" || scope === "file") && !current.date) return false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, workspaceRequestSignal()]);
    pending.current = controller;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (scope === "notes" ? current.notesDirty : current.logDirty) {
        const confirmed = await current.onConfirm({
          title: "导出已保存内容？",
          message: "当前编辑器有未保存修改，导出内容将以已保存的 Markdown 文件为准。",
          confirmLabel: "继续导出"
        });
        signal.throwIfAborted();
        if (!confirmed) return false;
      }
      const query = new URLSearchParams({ scope });
      if ((scope === "day" || scope === "file") && current.date) query.set("date", current.date);
      const result = await requestDownload(`/api/export?${query}`, { signal });
      signal.throwIfAborted();
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Give the browser time to consume the download URL before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setStatus(result.warningCount > 0
        ? `下载已开始；${result.warningCount} 个附件缺失，请查看 ZIP 内的导出说明.txt。`
        : "下载已开始");
      return true;
    } catch (cause) {
      if (!signal.aborted && pending.current === controller) {
        setError(cause instanceof Error ? cause.message : "导出失败，请重试");
      }
      return false;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }, []);

  return { run, busy, status, error, cancel };
}

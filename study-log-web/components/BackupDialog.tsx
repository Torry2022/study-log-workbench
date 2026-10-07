"use client";

import { ArchiveRestore, DatabaseBackup, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BackupDiffViewer } from "@/components/BackupDiffViewer";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import type { DayEntry } from "@/lib/types";
import "@/app/backup.css";

interface BackupVersion {
  id: string;
  kind: "write";
  createdAt: string;
  sizeBytes: number;
  fileName: string;
}
interface BackupOverview { write: BackupVersion[]; nextCursor: string | null }
interface BackupPreview {
  date: string;
  kind: "write";
  id: string;
  historicalContent: string;
  currentContent: string;
  currentVersion: string | null;
  backupVersion: string;
}
export interface BackupDialogProps {
  date: string;
  active?: boolean;
  onClose: () => void;
  beforeRestore: () => Promise<boolean>;
  onRestored: (day: DayEntry) => void;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(value));
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function BackupState({ kind, title, onRetry, compact = false }: {
  kind: "loading" | "error" | "empty"; title: string; onRetry?: () => void; compact?: boolean;
}) {
  return <div className={`workspace-state workspace-state-${kind} ${compact ? "backup-dialog-loading" : "backup-preview-empty"}`} role={kind === "error" ? "alert" : "status"}>
    <div className="workspace-state-body"><span className="workspace-state-title">{title}</span>
      {onRetry && <div className="workspace-state-actions"><button type="button" className="button secondary" onClick={onRetry}><RefreshCw size={14} />重试</button></div>}
    </div>
  </div>;
}

export function BackupDialog({ date, active = true, onClose, beforeRestore, onRestored }: BackupDialogProps) {
  const [versions, setVersions] = useState<BackupVersion[]>([]);
  const [selected, setSelected] = useState<BackupVersion | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState<"confirming" | "restoring" | null>(null);
  const [conflict, setConflict] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [versionsExpanded, setVersionsExpanded] = useState(true);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const cursor = useRef<string | null | undefined>(undefined);
  const listRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const restoreRequest = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const latest = useRef({ date, active, onClose, onRestored });
  latest.current = { date, active, onClose, onRestored };
  const { backdropRef, requestExit } = useDialogExit<HTMLDivElement>(closeDialog);

  function current(controller: AbortController) {
    return !controller.signal.aborted && latest.current.active && latest.current.date === date && !closing.current;
  }
  function closeDialog() {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    listRequest.current?.abort();
    previewRequest.current?.abort();
    requestExit(() => { if (latest.current.active && latest.current.date === date) latest.current.onClose(); });
  }

  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const root = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    const previous = {
      paddingRight: body.style.paddingRight,
      rootOverflow: root.style.overflow, overscrollBehavior: root.style.overscrollBehavior,
      scrollBehavior: root.style.scrollBehavior
    };
    const unlockScroll = lockBodyScroll();
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    root.style.overscrollBehavior = "none";
    return () => {
      unlockScroll();
      body.style.paddingRight = previous.paddingRight;
      root.style.overflow = previous.rootOverflow;
      root.style.overscrollBehavior = previous.overscrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(scrollX, scrollY);
      root.style.scrollBehavior = previous.scrollBehavior;
    };
  }, [active]);

  useEffect(() => {
    cursor.current = undefined;
    closing.current = false;
    busyRef.current = false;
    setVersions([]); setSelected(null); setPreview(null);
    setPreviewLoading(false); setBusy(null); setConflict(false);
    setError(""); setListError(""); setVersionsExpanded(true);
    return () => {
      listRequest.current?.abort();
      previewRequest.current?.abort();
      restoreRequest.current?.abort();
    };
  }, [date, active]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true); setListError("");
    // Continue bounded server pages automatically, retaining already-loaded
    // versions and the failed cursor so a retry does not discard a comparison.
    void (async () => {
      try {
        do {
          const params = new URLSearchParams({ date });
          if (cursor.current) params.set("cursor", cursor.current);
          const { backup } = await requestJson<{ backup: BackupOverview }>(`/api/backups?${params}`, { signal: controller.signal });
          if (!current(controller)) return;
          setVersions(items => [...items, ...backup.write]);
          cursor.current = backup.nextCursor;
        } while (cursor.current);
      } catch (loadError) {
        if (current(controller)) setListError(loadError instanceof Error ? loadError.message : "读取历史版本失败");
      } finally {
        if (current(controller)) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [date, active, listRetry]);

  async function selectVersion(version: BackupVersion) {
    if (!active || busyRef.current || closing.current) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setSelected(version); setPreview(null); setPreviewLoading(true);
    setError(""); setConflict(false);
    try {
      const params = new URLSearchParams({ date, kind: "write", id: version.id });
      const { preview: result } = await requestJson<{ preview: BackupPreview }>(`/api/backups/preview?${params}`, { signal: controller.signal });
      if (current(controller)) { setPreview(result); setVersionsExpanded(false); }
    } catch (previewError) {
      if (current(controller)) setError(previewError instanceof Error ? previewError.message : "读取历史版本失败");
    } finally {
      if (current(controller)) setPreviewLoading(false);
    }
  }

  async function restoreSelected() {
    if (!selected || !preview || conflict || busyRef.current || !active || closing.current) return;
    const controller = new AbortController();
    restoreRequest.current = controller;
    // Lock before awaiting the parent confirmation: double-clicks cannot open
    // two confirmations or issue two writes using the same preview.
    busyRef.current = true; setBusy("confirming"); setError("");
    try {
      if (!(await beforeRestore()) || !current(controller)) return;
      setBusy("restoring");
      const { day } = await requestJson<{ day: DayEntry }>("/api/backups/restore", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ date, kind: "write", id: selected.id, baseVersion: preview.currentVersion, backupVersion: preview.backupVersion })
      });
      if (!current(controller)) return;
      latest.current.onRestored(day);
      closing.current = true;
      requestExit(() => { if (latest.current.active && latest.current.date === date) latest.current.onClose(); });
    } catch (restoreError) {
      if (current(controller)) {
        setError(restoreError instanceof Error ? restoreError.message : "恢复失败");
        if (restoreError instanceof ApiRequestError && restoreError.status === 409) setConflict(true);
      }
    } finally {
      if (restoreRequest.current === controller && !controller.signal.aborted) {
        busyRef.current = false; setBusy(null);
      }
    }
  }

  if (!active) return null;
  return (
    <div ref={backdropRef} className="backup-dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && closeDialog()}>
      <section className={`backup-dialog${maximized ? " maximized" : ""}`} role="dialog" aria-modal="true" aria-labelledby="backup-dialog-title">
        <header className="backup-dialog-header">
          <div><span className="backup-dialog-icon"><DatabaseBackup size={20} /></span><div><h2 id="backup-dialog-title">日志历史版本</h2><p>比较历史内容，恢复当前日块。</p></div></div>
          <div className="backup-dialog-window-actions">
            <button className="button icon-only backup-dialog-size-toggle" type="button" onClick={() => setMaximized(value => !value)} aria-label={maximized ? "还原历史版本窗口" : "最大化历史版本窗口"} title={maximized ? "还原" : "最大化"}>{maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            <button className="button icon-only" type="button" onClick={closeDialog} disabled={Boolean(busy)} aria-label="关闭日志历史版本"><X size={18} /></button>
          </div>
        </header>
        <div className="backup-dialog-content">
          <section className="backup-status-panel" aria-label="日块版本说明"><div className="backup-status-mark"><DatabaseBackup size={20} /></div><div><strong>保存前日块版本</strong><span>这里展示已保留的历史内容；恢复仅影响所选日期。</span></div></section>
          {error && <div className="backup-dialog-error" role="alert">{error}</div>}
          <button className="button backup-version-toggle" type="button" aria-expanded={versionsExpanded} aria-controls="backup-versions" onClick={() => setVersionsExpanded(value => !value)}>{selected ? `历史版本 · ${formatDateTime(selected.createdAt)}` : "选择历史版本"} · {versionsExpanded ? "收起" : "更换"}</button>
          <div className="backup-dialog-main" data-versions-expanded={versionsExpanded}>
            <aside id="backup-versions" className="backup-version-panel">
              <div className="backup-version-date"><span>恢复目标</span><strong>{date}</strong></div>
              <section className="backup-version-group"><header><strong>保存前版本</strong><span>最近 20 个不同的日块版本</span></header>
                <div className="backup-version-list">{versions.map(item => <button className={selected?.id === item.id ? "active" : ""} type="button" key={item.id} onClick={() => void selectVersion(item)} disabled={Boolean(busy)} aria-pressed={selected?.id === item.id}><span>{formatDateTime(item.createdAt)}</span><small>{formatSize(item.sizeBytes)}</small></button>)}</div>
                {loading ? <BackupState kind="loading" title={versions.length ? "正在读取更早版本" : "正在读取历史版本"} compact /> : listError ? <BackupState kind="error" title={listError} onRetry={() => setListRetry(value => value + 1)} compact /> : !versions.length && <p className="backup-version-empty">暂无历史版本</p>}
              </section>
            </aside>
            <section className="backup-preview-panel">
              {previewLoading ? <BackupState kind="loading" title="正在读取历史日块" /> : preview ? <>
                <BackupDiffViewer key={`${preview.id}:${preview.currentVersion}:${preview.backupVersion}`} currentContent={preview.currentContent} historicalContent={preview.historicalContent} historicalLabel={selected ? formatDateTime(selected.createdAt) : "历史版本"} />
                <footer className="backup-dialog-actions"><p>{conflict ? "内容已变化，请重新预览并确认后再恢复。" : "仅恢复所选日期，其他日期保持不变。"}</p>
                  {conflict ? <button className="button secondary" type="button" onClick={() => selected && void selectVersion(selected)}><RefreshCw size={16} />重新预览</button> : <button className="button primary" type="button" onClick={() => void restoreSelected()} disabled={Boolean(busy)}><ArchiveRestore size={16} />{busy === "confirming" ? "等待确认" : busy === "restoring" ? "恢复中" : "恢复此版本"}</button>}
                </footer>
              </> : selected && error ? <BackupState kind="error" title="未能读取历史日块" onRetry={() => void selectVersion(selected)} /> : <BackupState kind="empty" title="选择一个版本，查看历史内容" />}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

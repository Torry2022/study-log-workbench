"use client";

import "@/app/rag-history.css";

import { ChevronLeft, ChevronRight, MessageSquareText, MoreHorizontal, Plus, Search, SquarePen, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { containModalFocus, lockBodyScroll } from "@/hooks/use-dialog-exit";
import { WorkspaceState } from "@/components/WorkspaceState";
import type { RagSessionSummary } from "@/lib/rag-types";
import { ragSessionGroup as sessionGroup, ragUpdatedLabel as updatedLabel } from "@/lib/rag-history-view";

interface RagHistorySidebarProps {
  active: boolean;
  visible: boolean;
  collapsed: boolean;
  sessions: RagSessionSummary[];
  activeSessionId: string;
  query: string;
  loading: boolean;
  generating: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onNew: () => void;
  onQueryChange: (value: string) => void;
  onOpen: (id: string) => Promise<boolean>;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type PopoverMode = "recent" | "search" | null;

export function RagHistorySidebar({
  active,
  visible,
  collapsed,
  sessions,
  activeSessionId,
  query,
  loading,
  generating,
  onCollapse,
  onExpand,
  onNew,
  onQueryChange,
  onOpen,
  onRename,
  onDelete
}: RagHistorySidebarProps) {
  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [menuId, setMenuId] = useState("");
  const [renameId, setRenameId] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [busyId, setBusyId] = useState("");
  const collapsedRootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const activeSessionRef = useRef<HTMLDivElement | null>(null);
  const deleteConfirmationRef = useRef<HTMLDivElement | null>(null);
  const epoch = useRef(0);
  const enabled = active && visible;
  const deleteVisible = enabled && !loading && sessions.some(session => session.id === deleteId);

  useEffect(() => {
    if (!enabled) {
      setPopoverMode(null); setMenuId(""); setRenameId(""); setDeleteId(""); setBusyId("");
    }
    return () => { epoch.current++; };
  }, [enabled]);

  useEffect(() => {
    if (!collapsed) setPopoverMode(null);
  }, [collapsed]);

  useEffect(() => {
    if (!deleteVisible || !deleteConfirmationRef.current) return;
    const unlockScroll = lockBodyScroll();
    const releaseFocus = containModalFocus(deleteConfirmationRef.current, () => setDeleteId(""));
    return () => { releaseFocus(); unlockScroll(); };
  }, [deleteVisible, deleteId, collapsed, popoverMode]);

  const groups = useMemo(() => {
    const grouped = new Map<string, RagSessionSummary[]>();
    for (const session of sessions) {
      const label = sessionGroup(session.updatedAt);
      grouped.set(label, [...(grouped.get(label) || []), session]);
    }
    return ["今天", "昨天", "近7天", "更早"]
      .map((label) => ({ label, sessions: grouped.get(label) || [] }))
      .filter((group) => group.sessions.length > 0);
  }, [sessions]);

  useEffect(() => {
    if (!enabled || (collapsed && !popoverMode) || !activeSessionId || loading) return;
    const frame = requestAnimationFrame(() => {
      const item = activeSessionRef.current, list = item?.closest<HTMLElement>(".rag-history-groups");
      if (!item || !list) return;
      const row = item.getBoundingClientRect(), bounds = list.getBoundingClientRect();
      const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
      if (row.top < top) list.scrollTop -= top - row.top;
      else if (row.bottom > bottom) list.scrollTop += row.bottom - bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, activeSessionId, collapsed, groups, popoverMode, loading]);

  useEffect(() => {
    if (!enabled || !popoverMode) return;
    function closeOnPointerDown(event: globalThis.MouseEvent) {
      if (!collapsedRootRef.current?.contains(event.target as Node)) setPopoverMode(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPopoverMode(null);
    }
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [enabled, popoverMode]);

  useEffect(() => {
    if (!enabled || popoverMode !== "search") return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [enabled, popoverMode]);

  async function commitRename(id: string) {
    const title = renameTitle.trim();
    if (!enabled || !title || busyId) return;
    const token = epoch.current;
    setBusyId(id);
    try {
      await onRename(id, title);
      if (token !== epoch.current) return;
      setRenameId("");
      setMenuId("");
    } catch {
      // The parent surfaces the request error.
    } finally {
      if (token === epoch.current) setBusyId("");
    }
  }

  async function confirmDelete(id: string) {
    if (!enabled || busyId) return;
    const token = epoch.current;
    setBusyId(id);
    try {
      await onDelete(id);
      if (token !== epoch.current) return;
      setDeleteId("");
      setMenuId("");
    } catch {
      // The parent surfaces the request error.
    } finally {
      if (token === epoch.current) setBusyId("");
    }
  }

  function renderSearchInput(autoFocus = false) {
    return (
      <div className="rag-history-search">
        <Search size={14} />
        <input
          ref={autoFocus ? searchRef : undefined}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索历史问答"
          aria-label="搜索历史问答"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange("")} aria-label="清空历史搜索">
            <X size={13} />
          </button>
        )}
      </div>
    );
  }

  function renderSessionList() {
    if (loading) return <WorkspaceState kind="loading" title="正在加载历史记录" layout="compact" className="rag-history-empty" />;
    if (groups.length === 0) return <WorkspaceState kind="empty" title={query ? "未找到匹配会话" : "暂无历史问答"} layout="compact" className="rag-history-empty" />;

    return (
      <div className="rag-history-groups">
        {groups.map((group) => (
          <section className="rag-history-group" key={group.label}>
            <div className="rag-history-group-title">{group.label}</div>
            {group.sessions.map((session) => (
              <div
                className={`rag-session-item${session.id === activeSessionId ? " active" : ""}`}
                key={session.id}
                ref={session.id === activeSessionId ? activeSessionRef : undefined}
              >
                {renameId === session.id ? (
                  <form
                    className="rag-session-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void commitRename(session.id);
                    }}
                  >
                    <input
                      autoFocus
                      disabled={busyId === session.id}
                      value={renameTitle}
                      onChange={(event) => setRenameTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenameId("");
                      }}
                      aria-label="会话标题"
                    />
                  </form>
                ) : (
                  <button
                    className="rag-session-main"
                    type="button"
                    disabled={generating || Boolean(busyId)}
                    onClick={async () => {
                      const token = epoch.current;
                      try { if (await onOpen(session.id) && token === epoch.current) setPopoverMode(null); }
                      catch { /* The controller preserves the current session and surfaces the error. */ }
                    }}
                    title={session.title}
                  >
                    <span>{session.title}</span>
                    <small>{updatedLabel(session.updatedAt)}</small>
                  </button>
                )}
                <button
                  className="rag-session-menu-button"
                  type="button"
                  disabled={generating || Boolean(busyId)}
                  onClick={() => {
                    setMenuId((current) => (current === session.id ? "" : session.id));
                    setDeleteId("");
                  }}
                  aria-label={`管理会话：${session.title}`}
                >
                  <MoreHorizontal size={15} />
                </button>
                {menuId === session.id && (
                  <div className="rag-session-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameId(session.id);
                        setRenameTitle(session.title);
                        setMenuId("");
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => {
                        setDeleteId(session.id);
                        setMenuId("");
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
                {deleteId === session.id && (
                  <div ref={deleteConfirmationRef} className="rag-session-delete-confirm" role="dialog" aria-modal="true" aria-label="确认删除会话">
                    <span>删除此会话？</span>
                    <div>
                      <button type="button" onClick={() => setDeleteId("")}>取消</button>
                      <button type="button" disabled={busyId === session.id} onClick={() => void confirmDelete(session.id)}>删除</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div className="sidebar-rail rag-history-rail" hidden={!enabled} ref={collapsedRootRef}>
        <button className="sidebar-rail-button" onClick={onExpand} title="展开左侧栏" aria-label="展开左侧栏">
          <ChevronRight size={18} />
        </button>
        <button className="sidebar-rail-button" onClick={onNew} disabled={generating} title="新建问答" aria-label="新建问答">
          <SquarePen size={17} />
        </button>
        <button
          className={`sidebar-rail-button${popoverMode === "search" ? " active" : ""}`}
          onClick={() => setPopoverMode((current) => (current === "search" ? null : "search"))}
          title="搜索历史"
          aria-label="搜索历史"
        >
          <Search size={17} />
        </button>
        <button
          className={`sidebar-rail-button${popoverMode === "recent" ? " active" : ""}`}
          onClick={() => {
            onQueryChange("");
            setPopoverMode((current) => (current === "recent" ? null : "recent"));
          }}
          title="最近问答"
          aria-label="最近问答"
        >
          <MessageSquareText size={17} />
        </button>
        {popoverMode && (
          <div className="rag-history-popover" onPointerDown={(event) => event.stopPropagation()}>
            <div className="rag-history-popover-title">{popoverMode === "search" ? "搜索历史" : "最近问答"}</div>
            {popoverMode === "search" && renderSearchInput(true)}
            {renderSessionList()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rag-history-sidebar" hidden={!enabled}>
      <div className="sidebar-heading">
        <div className="section-title inline">
          <MessageSquareText size={15} />
          <span>知识问答</span>
        </div>
        <button className="sidebar-collapse-button" onClick={onCollapse} title="折叠左侧栏" aria-label="折叠左侧栏">
          <ChevronLeft size={16} />
        </button>
      </div>
      <button className="button secondary full" type="button" onClick={onNew} disabled={generating}>
        <Plus size={15} />
        新建问答
      </button>
      {renderSearchInput()}
      {renderSessionList()}
    </div>
  );
}

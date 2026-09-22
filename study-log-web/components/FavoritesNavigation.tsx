"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, Edit3, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { FavoritesController } from "@/hooks/use-favorites";
import "@/app/favorites.css";

type GroupControl = { id: string; mode: "menu" | "rename" | "delete" | "create"; top: number; left: number };
export function FavoritesNavigation({ favorites, active = true }: { favorites: FavoritesController; active?: boolean }) {
  const [control, setControl] = useState<GroupControl | null>(null);
  const [name, setName] = useState("");
  const [monthsExpanded, setMonthsExpanded] = useState(false);
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!active || !favorites.active) setControl(null); }, [active, favorites.active]);
  useEffect(() => {
    if (!control) return;
    const pointer = (event: PointerEvent) => { if (!navigation.current?.contains(event.target as Node)) setControl(null); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setControl(null); } };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [control]);
  function open(id: string, mode: "menu" | "create", trigger: HTMLButtonElement) {
    const rect = trigger.getBoundingClientRect();
    const width = mode === "create" ? 260 : 240;
    const height = mode === "create" ? 150 : 180;
    setControl(current => current?.id === id ? null : { id, mode, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 8 : Math.max(12, rect.top - height - 8) });
    setName("");
  }
  const inGroup = favorites.favorites.filter(item => favorites.filters.group === "all" || (favorites.filters.group === "ungrouped" ? !item.groupIds.length : item.groupIds.includes(favorites.filters.group)));
  const months = [...new Set(inGroup.map(item => item.month))].sort((a, b) => b.localeCompare(a));
  const shownMonths = monthsExpanded ? months : months.filter((month, index) => index < 6 || month === favorites.filters.month);
  const managedGroup = favorites.groups.find(group => group.id === control?.id);
  return <div className="module-sidebar-content favorite-navigation" ref={navigation}>
    <div className="favorite-navigation-groups" aria-label="收藏分组筛选"><div className="section-title">收藏分组</div>
      <div className="favorite-navigation-list" role="navigation" aria-label="收藏分组">
        <button className={`favorite-filter-chip${favorites.filters.group === "all" ? " active" : ""}`} type="button" onClick={() => favorites.filter({ group: "all" })}>全部收藏 <span>{favorites.favorites.length}</span></button>
        <button className={`favorite-filter-chip${favorites.filters.group === "ungrouped" ? " active" : ""}`} type="button" onClick={() => favorites.filter({ group: "ungrouped" })}>未分组 <span>{favorites.favorites.filter(item => !item.groupIds.length).length}</span></button>
        {favorites.groups.map(group => <div className="favorite-filter-chip-wrap" key={group.id}><span className={`favorite-filter-chip compound${favorites.filters.group === group.id ? " active" : ""}`}>
          <button type="button" onClick={() => favorites.filter({ group: group.id })}>{group.name} <span>{favorites.favorites.filter(item => item.groupIds.includes(group.id)).length}</span></button>
          <button type="button" disabled={favorites.busy} onClick={event => open(group.id, "menu", event.currentTarget)} aria-label={`管理分组 ${group.name}`} aria-expanded={control?.id === group.id}><MoreHorizontal size={14} /></button>
        </span></div>)}
        <div className="favorite-group-create-wrap"><button className="favorite-filter-chip favorite-group-add" type="button" disabled={favorites.busy} onClick={event => open("new", "create", event.currentTarget)} aria-expanded={control?.mode === "create"} aria-label="新建分组"><Plus size={14} /></button></div>
      </div>
      {control?.mode === "create" ? <form className="favorite-group-create-popover" style={{ "--favorite-group-create-top": `${control.top}px`, "--favorite-group-create-left": `${control.left}px` } as CSSProperties} onSubmit={async event => { event.preventDefault(); if (await favorites.createGroup(name.trim())) setControl(null); }}>
        <label htmlFor="favorite-group-new-name">新建分组</label><input id="favorite-group-new-name" value={name} onChange={event => setName(event.target.value)} placeholder="分组名称" autoFocus disabled={favorites.busy} /><button type="submit" disabled={!name.trim() || favorites.busy}>创建</button>{favorites.error && <span className="favorites-error" role="alert">{favorites.error}</span>}
      </form> : control && managedGroup && <div className="favorite-group-menu" style={{ "--favorite-group-menu-top": `${control.top}px`, "--favorite-group-menu-left": `${control.left}px` } as CSSProperties}>
        {control.mode === "rename" ? <form className="favorite-group-rename" onSubmit={async event => { event.preventDefault(); if (await favorites.renameGroup(managedGroup.id, name.trim())) setControl(null); }}>
          <label htmlFor="favorite-group-rename-name">重命名分组</label><input id="favorite-group-rename-name" value={name} onChange={event => setName(event.target.value)} autoFocus disabled={favorites.busy} /><div><button type="button" onClick={() => setControl(null)}>取消</button><button type="submit" disabled={!name.trim() || favorites.busy}>保存</button></div>
        </form> : control.mode === "delete" ? <div className="favorite-group-delete-confirm"><strong>删除“{managedGroup.name}”？</strong><span>收藏内容不会被删除。</span><div><button type="button" onClick={() => setControl(null)}>保留</button><button type="button" disabled={favorites.busy} onClick={async () => { if (await favorites.deleteGroup(managedGroup.id)) setControl(null); }}>删除</button></div></div> : <>
          <button type="button" onClick={() => { setName(managedGroup.name); setControl({ ...control, mode: "rename" }); }}><Edit3 size={14} />重命名</button><button type="button" className="danger" onClick={() => setControl({ ...control, mode: "delete" })}><Trash2 size={14} />删除分组</button>
        </>}{favorites.error && <span className="favorites-error" role="alert">{favorites.error}</span>}
      </div>}
    </div>
    <div className="sidebar-section"><div className="section-title inline"><CalendarDays size={15} />日志月份</div><div className="month-list">
      <button className={`nav-item${favorites.filters.month === "all" ? " active" : ""}`} type="button" onClick={() => favorites.filter({ month: "all" })}><span>全部月份</span><small>{inGroup.length}</small></button>
      {shownMonths.map(month => <button className={`nav-item${favorites.filters.month === month ? " active" : ""}`} type="button" key={month} onClick={() => favorites.filter({ month })}><span>{month}</span><small>{inGroup.filter(item => item.month === month).length}</small></button>)}
    </div>{months.length > 6 && <button className="button secondary" type="button" onClick={() => setMonthsExpanded(value => !value)}>{monthsExpanded ? "收起月份" : "展开全部月份"}</button>}</div>
  </div>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, FileText, Grid2X2, LayoutList, Search, Star, X } from "lucide-react";
import { WorkspaceState } from "./WorkspaceState";
import { FavoriteGroupDialog } from "./FavoriteGroupDialog";
import { FavoriteRemovePopover } from "./FavoriteFeedback";
import type { FavoritesController } from "@/hooks/use-favorites";
import type { FavoriteHeading } from "@/lib/favorites-types";
import "@/app/favorites.css";

export function FavoritesModule({ favorites, active = true, onOpen, onOpenLog }: {
  onOpenLog?: () => void;
  favorites: FavoritesController; active?: boolean; onOpen: (date: string, heading: string, missing?: boolean) => Promise<boolean>;
}) {
  const [query, setQuery] = useState(favorites.filters.query);
  const [groupId, setGroupId] = useState("");
  const [remove, setRemove] = useState<{ favorite: FavoriteHeading; top: number; left: number } | null>(null);
  useEffect(() => { if (!active || !favorites.active) { setGroupId(""); setRemove(null); } }, [active, favorites.active]);
  const monthGroups = useMemo(() => {
    const result = new Map<string, FavoriteHeading[]>();
    for (const favorite of favorites.visible) {
      const key = favorites.filters.sort === "saved-date" ? "saved" : favorite.month;
      result.set(key, [...result.get(key) || [], favorite]);
    }
    return [...result];
  }, [favorites.visible, favorites.filters.sort]);
  const groupsById = new Map(favorites.groups.map(group => [group.id, group.name]));
  function viewSwitch(className: string) {
    return <div className={`favorites-view-switch ${className}`} aria-label="收藏展示方式">
      <button className={favorites.view === "list" ? "active" : ""} type="button" onClick={() => favorites.setView("list")} aria-label="列表视图" aria-pressed={favorites.view === "list"}><LayoutList size={16} /></button>
      <button className={favorites.view === "grid" ? "active" : ""} type="button" onClick={() => favorites.setView("grid")} aria-label="卡片视图" aria-pressed={favorites.view === "grid"}><Grid2X2 size={15} /></button>
    </div>;
  }
  if (!active || !favorites.active) return null;
  return <>
    <div className="reader-toolbar-container"><div className="reader-toolbar favorites-toolbar">
      <div className="favorites-title-block module-title-block"><div className="reader-heading-row favorites-title-row"><h2>收藏中心</h2></div></div>
      <div className="reader-controls favorites-header-actions">
        <form className="favorites-search" onSubmit={event => { event.preventDefault(); favorites.filter({ query }); }}>
          <Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={favorites.filters.headingsOnly ? "搜索收藏小节标题" : "搜索收藏标题或内容"} aria-label="搜索收藏" />
          <button className={`search-heading-toggle${favorites.filters.headingsOnly ? " active" : ""}`} type="button" onClick={() => favorites.filter({ headingsOnly: !favorites.filters.headingsOnly })} aria-pressed={favorites.filters.headingsOnly} aria-label="仅搜索收藏小节标题">H3</button>
          <button className={`search-case-toggle${favorites.filters.ignoreCase ? "" : " active"}`} type="button" onClick={() => favorites.filter({ ignoreCase: !favorites.filters.ignoreCase })} aria-pressed={!favorites.filters.ignoreCase} aria-label="收藏搜索区分大小写">Aa</button>
          <button className="search-submit" type="submit" disabled={!query.trim()} aria-label="搜索收藏内容"><Search size={14} /></button>
          {(query || favorites.filters.query) && <button className="search-clear" type="button" onClick={() => { setQuery(""); favorites.filter({ query: "" }); }} aria-label="清空收藏搜索"><X size={14} /></button>}
        </form>
        <div className="stats-month-control favorites-sort-control"><ArrowUpDown size={16} /><select value={favorites.filters.sort} onChange={event => favorites.filter({ sort: event.target.value as "log-date" | "saved-date" })} aria-label="收藏排序方式"><option value="log-date">日志日期：最新优先</option><option value="saved-date">收藏时间：最新优先</option></select><ChevronDown size={15} /></div>
        {viewSwitch("favorites-view-switch-desktop")}{viewSwitch("favorites-view-switch-mobile")}
        {onOpenLog && <button className="button secondary" type="button" onClick={onOpenLog}><FileText size={15} />日志</button>}
      </div>
    </div></div>
    <div className="reader-content reader-content-favorites"><div className="favorites-view">
      {favorites.loaded && favorites.error && <div className="favorites-error" role="alert">{favorites.error}<button className="button secondary" type="button" disabled={favorites.loading || favorites.busy} onClick={() => void favorites.reload()}>重试</button></div>}
      {!favorites.loaded ? <WorkspaceState kind={favorites.error ? "error" : "loading"} title={favorites.error ? "收藏加载失败" : "正在加载收藏"} description={favorites.error || undefined} className="favorites-empty-state" actions={favorites.error ? <button className="button secondary" type="button" disabled={favorites.loading} onClick={() => void favorites.reload()}>重试</button> : undefined} /> : <>
        {favorites.favorites.length > 0 && <div className="favorites-results"><span>{favorites.visible.length} 条收藏{favorites.filters.group !== "all" && ` · ${favorites.filters.group === "ungrouped" ? "未分组" : groupsById.get(favorites.filters.group) || ""}`}{favorites.filters.query && ` · ${favorites.filters.query}`}</span>{favorites.loading && <span role="status">正在刷新</span>}</div>}
        {monthGroups.length ? <div className="favorites-groups">{monthGroups.map(([month, items]) => <section className="favorites-month-group" key={month}>
          {favorites.filters.sort === "log-date" && <div className="favorites-month-heading"><span>{month}</span><small>{items.length}</small></div>}
          <div className={`favorites-month-list ${favorites.view}`}>{items.map(favorite => <div key={favorite.id} className={`favorite-item favorite-item-center favorite-item-${favorites.view}${favorite.exists ? "" : " missing"}`}>
            <button className="favorite-item-main" type="button" onClick={() => { setRemove(null); void onOpen(favorite.date, favorite.exists ? favorite.resolvedHeadingId || favorite.headingId : "", !favorite.exists); }} title={favorite.exists ? favorite.headingText : `${favorite.headingText}（未找到）`}>
              <span className="favorite-date">{favorite.date}{favorites.filters.sort === "saved-date" && <small className="favorite-saved-date">收藏于 {new Date(favorite.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</small>}</span>
              <span className="favorite-title">{favorite.headingText}</span>{favorite.sectionPreview && <span className="favorite-preview">{favorite.sectionPreview}</span>}
              <span className="favorite-group-tags">{favorite.groupIds.length ? favorite.groupIds.map(id => <span className="favorite-group-tag" key={id}>{groupsById.get(id) || "未找到分组"}</span>) : <span className="favorite-group-tag muted">未分组</span>}</span>
              {!favorite.exists && <span className="favorite-missing">未找到</span>}
            </button>
            <button className="favorite-group-button" type="button" disabled={favorites.busy} onClick={() => setGroupId(favorite.id)} aria-label={`选择 ${favorite.headingText} 的收藏分组`}>分组</button>
            <button className="favorite-remove" type="button" disabled={favorites.busy} aria-label={`取消收藏 ${favorite.headingText}`} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setRemove({ favorite, top: rect.top + rect.height / 2, left: rect.left - 8 }); }}><X size={13} strokeWidth={2} /></button>
          </div>)}</div>
        </section>)}</div> : <WorkspaceState kind="empty" icon={Star} title={favorites.favorites.length ? "没有符合条件的收藏" : "暂无收藏"} description={!favorites.favorites.length ? "在日志目录中点亮小节旁的星标，方便以后回看。" : favorites.filters.headingsOnly ? favorites.filters.ignoreCase ? "试试其他标题关键词，或调整筛选条件。" : "搜索已区分大小写，也可以关闭 Aa 再查找。" : favorites.filters.ignoreCase ? "试试其他关键词，或调整月份筛选。" : "搜索已区分大小写，也可以关闭 Aa 再查找。"} layout="module" className="favorites-empty-state" />}
      </>}
    </div></div>
    {groupId && <FavoriteGroupDialog favoriteId={groupId} favorites={favorites} onClose={() => setGroupId("")} />}
    {remove && <FavoriteRemovePopover top={remove.top} left={remove.left} title={remove.favorite.headingText} busy={favorites.busy} error={favorites.error} onClose={() => setRemove(null)} onConfirm={() => favorites.remove(remove.favorite.id)} />}
  </>;
}

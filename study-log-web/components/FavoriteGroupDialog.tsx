"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import type { FavoritesController } from "@/hooks/use-favorites";
import "@/app/favorites.css";

export function FavoriteGroupDialog({ favoriteId, favorites, onClose, onOpenCenter }: {
  favoriteId: string; favorites: FavoritesController; onClose: () => void; onOpenCenter?: () => void;
}) {
  const favorite = favorites.favorites.find(item => item.id === favoriteId);
  const [name, setName] = useState("");
  const { backdropRef, requestExit } = useDialogExit(close);
  function close() { if (!favorites.busy) requestExit(onClose); }
  useEffect(() => { if (favorites.active && favorite) return lockBodyScroll(); }, [favorites.active, Boolean(favorite)]);
  if (!favorite || !favorites.active) return null;
  return createPortal(<div ref={backdropRef} className="favorite-group-dialog-backdrop" role="presentation" onClick={close}>
    <div className="favorite-group-dialog" role="dialog" aria-modal="true" aria-labelledby="favorite-group-dialog-title" onClick={event => event.stopPropagation()}>
      <div className="favorite-group-dialog-header"><div><h3 id="favorite-group-dialog-title">选择分组</h3></div><button type="button" onClick={close} disabled={favorites.busy} aria-label="关闭选择分组"><X size={18} /></button></div>
      {favorites.error && <div className="favorites-error" role="alert">{favorites.error}</div>}
      <div className="favorite-group-dialog-list">{favorites.groups.length ? favorites.groups.map(group => <label className="favorite-group-option" key={group.id}>
        <span><strong>{group.name}</strong><small>{favorites.favorites.filter(item => item.groupIds.includes(group.id)).length} 条收藏</small></span>
        <input type="checkbox" checked={favorite.groupIds.includes(group.id)} disabled={favorites.busy} onChange={event => void favorites.setGroup(favorite.id, group.id, event.target.checked)} />
      </label>) : <div className="favorite-group-empty">暂无自定义分组</div>}</div>
      <form className="favorite-group-dialog-create" onSubmit={async event => {
        event.preventDefault(); const group = await favorites.createGroup(name.trim());
        if (group && await favorites.setGroup(favorite.id, group.id, true)) setName("");
      }}><input value={name} onChange={event => setName(event.target.value)} placeholder="新建分组名称" aria-label="新建收藏分组名称" disabled={favorites.busy} /><button type="submit" disabled={!name.trim() || favorites.busy}>创建并加入</button></form>
      <div className="favorite-group-dialog-actions"><button type="button" disabled={favorites.busy} onClick={() => requestExit(() => { onClose(); onOpenCenter?.(); })}><Star size={14} />收藏中心</button>
        <div><button className="danger" type="button" disabled={favorites.busy} onClick={async () => { if (await favorites.remove(favorite.id)) onClose(); }}>取消收藏</button><button className="primary" type="button" onClick={close} disabled={favorites.busy}>完成</button></div>
      </div>
    </div>
  </div>, document.body);
}

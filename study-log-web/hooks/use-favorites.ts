"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/client-http";
import { filterFavorites, type FavoriteFilters } from "@/lib/favorites-view";
import type { FavoriteGroup, FavoriteHeading, FavoriteHeadingInput, FavoritesSnapshot } from "@/lib/favorites-types";

const empty: FavoritesSnapshot = { favorites: [], groups: [] };
export type FavoritesController = ReturnType<typeof useFavorites>;

/** One owner for reader stars, group navigation and the favorites workspace. */
export function useFavorites(active: boolean) {
  const [snapshot, setSnapshot] = useState<FavoritesSnapshot>(empty);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [filters, setFilters] = useState<FavoriteFilters>({ group: "all", month: "all", query: "", ignoreCase: true, headingsOnly: false, sort: "log-date" });
  const [view, setView] = useState<"list" | "grid">("list");
  const activeRef = useRef(active); activeRef.current = active;
  const reading = useRef<AbortController | null>(null);
  const writing = useRef<AbortController | null>(null);

  useEffect(() => {
    try { const saved = window.localStorage.getItem("study-log-favorites-view"); if (saved === "list" || saved === "grid") setView(saved); } catch { /* Storage may be disabled. */ }
  }, []);
  function chooseView(value: "list" | "grid") {
    setView(value);
    try { window.localStorage.setItem("study-log-favorites-view", value); } catch { /* The current view still works without persistence. */ }
  }

  const reload = useCallback(async () => {
    if (!activeRef.current || writing.current) return;
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    setLoading(true); setError("");
    try {
      const next = await requestJson<FavoritesSnapshot>("/api/favorites", { signal: controller.signal });
      if (controller.signal.aborted || !activeRef.current) return;
      setSnapshot(next); setLoaded(true);
      setFilters(current => current.group === "all" || current.group === "ungrouped" || next.groups.some(group => group.id === current.group)
        ? current : { ...current, group: "all" });
    } catch (failure) {
      if (!controller.signal.aborted && activeRef.current) setError(failure instanceof Error ? failure.message : "加载收藏失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void reload();
    return () => { reading.current?.abort(); writing.current?.abort(); writing.current = null; setBusyId(""); };
  }, [active, reload]);

  async function mutate<T>(id: string, init: RequestInit, apply: (current: FavoritesSnapshot, payload: T) => FavoritesSnapshot, suffix = ""): Promise<T | null> {
    if (!activeRef.current || writing.current) return null;
    reading.current?.abort(); setLoading(false);
    const controller = new AbortController(); writing.current = controller;
    setBusyId(id); setError("");
    let succeeded = false;
    try {
      const payload = await requestJson<T>(`/api/favorites${suffix}`, { ...init, signal: controller.signal });
      if (controller.signal.aborted || !activeRef.current) return null;
      // Apply the successful write even if its subsequent snapshot refresh fails.
      setSnapshot(current => apply(current, payload));
      succeeded = true;
      return payload;
    } catch (failure) {
      if (!controller.signal.aborted && activeRef.current) setError(failure instanceof Error ? failure.message : "收藏操作失败");
      return null;
    } finally {
      if (writing.current === controller) {
        writing.current = null; setBusyId("");
        if (succeeded && !controller.signal.aborted) void reload();
      }
    }
  }
  function replaceFavorite(current: FavoritesSnapshot, favorite: FavoriteHeading): FavoritesSnapshot {
    return { ...current, favorites: [...current.favorites.filter(item => item.id !== favorite.id), favorite] };
  }
  async function add(input: FavoriteHeadingInput) {
    const result = await mutate<{ favorite: FavoriteHeading }>(`${input.date}:${input.headingId}`, { method: "POST", body: JSON.stringify(input) }, (current, payload) => replaceFavorite(current, payload.favorite));
    return result?.favorite || null;
  }
  async function remove(id: string) {
    return Boolean(await mutate<{ ok: boolean }>(id, { method: "DELETE" }, current => ({ ...current, favorites: current.favorites.filter(item => item.id !== id) }), `?id=${encodeURIComponent(id)}`));
  }
  async function setGroups(id: string, groupIds: string[]) {
    const result = await mutate<{ favorite: FavoriteHeading }>(id, { method: "PATCH", body: JSON.stringify({ id, groupIds }) }, (current, payload) => replaceFavorite(current, payload.favorite));
    return result?.favorite || null;
  }
  async function createGroup(name: string) {
    const result = await mutate<{ group: FavoriteGroup }>("group:new", { method: "POST", body: JSON.stringify({ action: "createGroup", name }) }, (current, payload) => ({ ...current, groups: [...current.groups.filter(group => group.id !== payload.group.id), payload.group].sort((a, b) => a.order - b.order) }));
    return result?.group || null;
  }
  async function renameGroup(groupId: string, name: string) {
    return Boolean(await mutate<{ group: FavoriteGroup }>(`group:${groupId}`, { method: "PATCH", body: JSON.stringify({ action: "renameGroup", groupId, name }) }, (current, payload) => ({ ...current, groups: current.groups.map(group => group.id === groupId ? payload.group : group) })));
  }
  async function deleteGroup(groupId: string) {
    const result = await mutate<{ ok: boolean }>(`group:${groupId}`, { method: "DELETE" }, current => ({ favorites: current.favorites.map(item => ({ ...item, groupIds: item.groupIds.filter(id => id !== groupId) })), groups: current.groups.filter(group => group.id !== groupId) }), `?groupId=${encodeURIComponent(groupId)}`);
    if (result) setFilters(current => current.group === groupId ? { ...current, group: "all" } : current);
    return Boolean(result);
  }
  const visible = useMemo(() => filterFavorites(snapshot.favorites, filters), [snapshot.favorites, filters]);
  function filter(patch: Partial<FavoriteFilters>) { setFilters(current => ({ ...current, ...patch })); }
  return { ...snapshot, active, loaded, loading, error, busy: Boolean(busyId), busyId, reload,
    add, remove, setGroups, createGroup, renameGroup, deleteGroup, filters, filter, visible, view, setView: chooseView };
}

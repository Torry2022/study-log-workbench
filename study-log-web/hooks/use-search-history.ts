"use client";

import { useEffect, useState } from "react";

// localStorage is already isolated by origin (including port); keep the app path in the key.
export const SEARCH_HISTORY_STORAGE_KEY = "study-log:/study-log:search-history";
export const SEARCH_HISTORY_LIMIT = 8;
const HISTORY_CLEARED_EVENT = "study-log:search-history-cleared";

export function readSearchHistory(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.filter((item): item is string => typeof item === "string")
      .map(item => item.trim()).filter(item => item.length > 0 && item.length <= 500))].slice(0, SEARCH_HISTORY_LIMIT);
  } catch { return []; }
}

function persistSearchHistory(history: string[]): void {
  try {
    if (history.length) window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
    else window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  } catch { /* Search remains available when browser storage is disabled. */ }
}

/** Call only after explicit logout succeeds; an expired login retains the workspace. */
export function clearSearchSessionHistory(): void {
  persistSearchHistory([]);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HISTORY_CLEARED_EVENT));
}

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setHistory(readSearchHistory());
    const cleared = () => setHistory([]);
    const synced = (event: StorageEvent) => {
      if (event.key === SEARCH_HISTORY_STORAGE_KEY || event.key === null) setHistory(readSearchHistory());
    };
    window.addEventListener(HISTORY_CLEARED_EVENT, cleared);
    window.addEventListener("storage", synced);
    return () => { window.removeEventListener(HISTORY_CLEARED_EVENT, cleared); window.removeEventListener("storage", synced); };
  }, []);
  function remember(term: string) {
    const normalized = term.trim();
    if (!normalized || normalized.length > 500) return;
    const next = [normalized, ...history.filter(item => item !== normalized)].slice(0, SEARCH_HISTORY_LIMIT);
    persistSearchHistory(next); setHistory(next);
  }
  function remove(term: string) {
    const next = history.filter(item => item !== term);
    persistSearchHistory(next); setHistory(next);
  }
  return { history, remember, remove, clear: clearSearchSessionHistory };
}

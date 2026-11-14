"use client";

import { useEffect } from "react";

export function useAiSettingsRefresh(active: boolean, refresh: () => unknown) {
  useEffect(() => {
    if (!active) return;
    const reload = () => { void refresh(); };
    window.addEventListener("study-log:ai-settings-saved", reload);
    return () => window.removeEventListener("study-log:ai-settings-saved", reload);
  }, [active, refresh]);
}

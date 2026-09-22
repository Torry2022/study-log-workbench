"use client";

import { useEffect, useState } from "react";

export function useTheme() {
  const [preference, setPreference] = useState<"system" | "light" | "dark">(() => {
    try {
      const stored = localStorage.getItem("study-log-theme");
      return stored === "dark" || stored === "light" ? stored : "system";
    } catch { return "system"; }
  });
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const next = preference === "dark" || (preference === "system" && media.matches) ? "dark" : "light";
      setTheme(next); document.documentElement.dataset.theme = next;
    };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);
  const chooseTheme = (value: "system" | "light" | "dark") => {
    setPreference(value);
    try { localStorage.setItem("study-log-theme", value); } catch { /* Keep the in-memory preference. */ }
  };
  return { theme, preference, chooseTheme };
}

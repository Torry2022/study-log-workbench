import type { MonthSummary, DaySummary } from "./types";
import type { MarkdownHeading } from "./markdown-outline";

// Only a same-tab reload may use this snapshot; normal navigation keeps its own anchors.
export const LOG_RELOAD_KEY = "study-log-reload-position";

export type LogReloadContext = {
  months: MonthSummary[];
  days: DaySummary[];
  fileName: string;
  outline: MarkdownHeading[];
  activeHeadingId: string;
};

export function readLogReloadContext(value: unknown): LogReloadContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as LogReloadContext;
  if (typeof context.fileName !== "string" || typeof context.activeHeadingId !== "string" ||
      !Array.isArray(context.months) || !context.months.every(item => item &&
        typeof item.id === "string" && typeof item.label === "string" && Number.isFinite(item.dayCount)) ||
      !Array.isArray(context.days) || !context.days.every(item => item &&
        typeof item.date === "string" && typeof item.month === "string" && typeof item.fileName === "string" &&
        Array.isArray(item.headings) && item.headings.every(title => typeof title === "string")) ||
      !Array.isArray(context.outline) || !context.outline.every(item => item &&
        typeof item.id === "string" && typeof item.text === "string" &&
        Number.isInteger(item.level) && item.level >= 1 && item.level <= 6 && Number.isInteger(item.line))) return null;
  return context;
}

export type LogReloadSnapshot = {
  url: string;
  date: string;
  mode: string;
  height: number;
  position: { windowTop: number; previewTop: number; editorTop: number };
  context?: LogReloadContext;
};

export const logReloadInitializer = `(() => {
  try {
    const raw = sessionStorage.getItem(${JSON.stringify(LOG_RELOAD_KEY)});
    sessionStorage.removeItem(${JSON.stringify(LOG_RELOAD_KEY)});
    if (performance.getEntriesByType("navigation")[0]?.type !== "reload" || !raw) return;
    const snapshot = JSON.parse(raw);
    if (snapshot.url !== location.href || !/^\\d{4}-\\d{2}-\\d{2}$/.test(snapshot.date) ||
        !["preview", "source", "split"].includes(snapshot.mode) ||
        !Number.isFinite(snapshot.height) || snapshot.height < 0 ||
        ![snapshot.position?.windowTop, snapshot.position?.previewTop, snapshot.position?.editorTop]
          .every(value => Number.isFinite(value) && value >= 0) ||
        !(Object.values(snapshot.position).some(value => value > 0) || snapshot.context)) return;
    const root = document.documentElement;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    root.dataset.logReload = "pending";
    root.style.setProperty("--log-reload-height", snapshot.height + "px");
    const cancel = () => window.__studyLogReload?.finish();
    const cancelOnKey = event => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel();
    };
    window.__studyLogReload = { snapshot, active: true, scrollRestoration: previousRestoration, finish: () => {
      if (!window.__studyLogReload?.active) return;
      window.__studyLogReload.active = false;
      delete root.dataset.logReload;
      root.style.removeProperty("--log-reload-height");
      history.scrollRestoration = window.__studyLogReload.scrollRestoration;
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancelOnKey);
    }};
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("keydown", cancelOnKey);
    // A failed script download must never leave the application covered forever.
    setTimeout(() => window.__studyLogReload?.finish(), 15000);
  } catch { /* Unavailable storage follows the ordinary loading path. */ }
})();`;

declare global {
  interface Window {
    __studyLogReload?: { snapshot: LogReloadSnapshot; active: boolean; scrollRestoration: ScrollRestoration; finish: () => void };
  }
}

declare global {
  interface Window { studyLogDesktop?: { close: () => void } }
}

export function closeDesktopWindow(): boolean {
  if (!window.studyLogDesktop) return false;
  window.studyLogDesktop.close();
  return true;
}

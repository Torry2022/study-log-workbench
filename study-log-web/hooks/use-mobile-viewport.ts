"use client";

import { useEffect, useState } from "react";

export function useMobileViewport(compact: boolean) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    if (!compact) {
      setKeyboardOpen(false);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let width = window.innerWidth;
    let baseline = Math.max(window.innerHeight, viewport.height);
    let frame = 0;
    function update() {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && (
        active.isContentEditable ||
        active instanceof HTMLTextAreaElement && !active.readOnly && !active.disabled ||
        active instanceof HTMLInputElement && !active.readOnly && !active.disabled &&
          /^(text|search|email|url|tel|password|number)$/.test(active.type)
      );
      // A width change establishes a new orientation/window baseline. Browser
      // chrome and pinch zoom alone must not be treated as a keyboard.
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        baseline = window.innerHeight;
      }
      const unscaled = Math.abs(viewport!.scale - 1) < 0.05;
      if (!editing && unscaled) baseline = Math.max(window.innerHeight, viewport!.height);
      const open = editing && unscaled && baseline - viewport!.height > 140;
      setKeyboardOpen(open);
      root.dataset.mobileKeyboard = open ? "open" : "closed";
      root.style.setProperty("--mobile-viewport-height", `${viewport!.height}px`);
      root.style.setProperty("--mobile-viewport-top", `${viewport!.offsetTop}px`);
      root.style.setProperty("--mobile-viewport-bottom", `${Math.max(0, window.innerHeight - viewport!.height - viewport!.offsetTop)}px`);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      delete root.dataset.mobileKeyboard;
      for (const name of ["height", "top", "bottom"]) root.style.removeProperty(`--mobile-viewport-${name}`);
    };
  }, [compact]);
  return keyboardOpen;
}

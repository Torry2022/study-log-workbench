"use client";

import { useLayoutEffect, useRef } from "react";

// A manual disclosure owns bottom position only if the reader was already there.
export function useRagDisclosure<T extends HTMLElement>(expanded: boolean) {
  const ref = useRef<T>(null);
  const pending = useRef<{ height: number; bottom: boolean } | null>(null);
  const prepare = () => {
    if (!ref.current) return;
    pending.current = { height: ref.current.getBoundingClientRect().height,
      bottom: document.documentElement.scrollHeight - innerHeight - scrollY <= 32 };
  };
  useLayoutEffect(() => {
    const element = ref.current, before = pending.current;
    pending.current = null;
    if (!element || !before) return;
    let frame = 0, pinned = before.bottom;
    const follow = () => { if (pinned) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }); };
    const stop = () => { pinned = false; };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { follow(); return; }
    const height = element.getBoundingClientRect().height;
    const overflow = element.style.overflow;
    element.style.overflow = "hidden";
    const animation = element.animate([{ height: `${before.height}px` }, { height: `${height}px` }], { duration: 180, easing: "ease-out" });
    const tick = () => { follow(); if (animation.playState === "running") frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    window.addEventListener("wheel", stop, { passive: true }); window.addEventListener("touchstart", stop, { passive: true }); window.addEventListener("keydown", stop);
    const clean = () => {
      cancelAnimationFrame(frame); element.style.overflow = overflow;
      window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); window.removeEventListener("keydown", stop);
    };
    animation.onfinish = () => { follow(); clean(); };
    return () => { animation.cancel(); clean(); };
  }, [expanded]);
  return { ref, prepare };
}

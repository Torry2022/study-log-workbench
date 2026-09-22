"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import "@/app/favorites.css";

interface Position { top: number; left: number; onClose: () => void }
function position({ top, left }: Position): CSSProperties {
  return { "--favorite-notice-top": `${top}px`, "--favorite-notice-left": `${left}px` } as CSSProperties;
}

export function FavoriteSuccessNotice(props: Position & { onGroup: () => void }) {
  const close = useRef(props.onClose); close.current = props.onClose;
  useEffect(() => { const timer = setTimeout(() => close.current(), 5200); return () => clearTimeout(timer); }, []);
  return createPortal(<div className="favorite-feedback-popover favorite-success-notice" role="status" style={position(props)}><span>收藏成功</span><button type="button" onClick={() => { props.onClose(); props.onGroup(); }}>选择分组<ChevronRight size={14} /></button></div>, document.body);
}

export function FavoriteRemovePopover(props: Position & { title: string; busy: boolean; error?: string; onConfirm: () => Promise<boolean> }) {
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(props.onClose); close.current = props.onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const pointer = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) close.current(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close.current(); } };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard);
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div ref={element} className="favorite-feedback-popover favorite-delete-popover" role="dialog" aria-label={`确认取消收藏 ${props.title}`} style={position(props)}><span>取消收藏？</span>
    {props.error && <span className="favorites-error" role="alert">{props.error}</span>}
    <div className="favorite-delete-actions"><button type="button" onClick={props.onClose}>保留</button><button type="button" disabled={props.busy} onClick={async () => { if (await props.onConfirm()) props.onClose(); }}>确认</button></div>
  </div>, document.body);
}

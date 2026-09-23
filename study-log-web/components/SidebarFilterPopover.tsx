"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "@/app/sidebar-filters.css";
import { SidebarFilterHeading } from "@/components/SidebarFilterHeading";

export function SidebarFilterPopover({ label, icon, children, filtered, onReset, active = true }: { active?: boolean; label: string; icon: ReactNode; children: ReactNode; filtered: boolean; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 8, left: 64, maxHeight: 400, width: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => { if (!active) setOpen(false); }, [active]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 16);
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - Math.min(480, window.innerHeight - 16) - 8));
      setPosition({ top, left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - width - 8)), maxHeight: window.innerHeight - top - 8, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <>
    <button ref={trigger} className={`sidebar-rail-button${open ? " active" : ""}`} type="button" title={label} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{icon}</button>
    {open && active && createPortal(<div ref={panel} id={id} className="sidebar-filter-popover" style={position} role="dialog" aria-label={label} tabIndex={-1}>
      <SidebarFilterHeading title={label} filtered={filtered} onReset={onReset} />
      {children}
    </div>, document.body)}
  </>;
}

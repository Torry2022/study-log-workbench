"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { ExportScope } from "@/hooks/use-export";
import "@/app/export.css";

type ExportItem = { scope: ExportScope; label: string; disabled?: boolean };
type ExportMenuProps = {
  scopes: ExportItem[];
  onExport: (scope: ExportScope) => unknown;
  busy: boolean;
  disabled?: boolean;
  variant?: "menu" | "items";
};

export function ExportMenu({ scopes, onExport, busy, disabled = false, variant = "menu" }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (busy || disabled) setOpen(false); }, [busy, disabled]);

  const items = scopes.map((item) => <button key={item.scope} type="button" role="menuitem"
    disabled={disabled || busy || item.disabled}
    onClick={() => { setOpen(false); if (variant === "menu") trigger.current?.focus(); void onExport(item.scope); }}>
    {item.label}
  </button>);
  if (variant === "items") return <>{items}</>;
  return <div className="export-menu log-action-export" ref={wrapper}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        const buttons = Array.from(wrapper.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <button ref={trigger} type="button" className="button secondary" title="导出" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled || busy}
      onClick={() => setOpen((value) => !value)}><Download size={15} />{busy ? "导出中…" : "导出"}</button>
    {open && <div id={id} className="export-popover" role="menu" aria-label="导出范围">{items}</div>}
  </div>;
}

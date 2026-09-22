"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";

export type ConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmDialogProps = ConfirmationOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "default",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const { backdropRef, requestExit } = useDialogExit<HTMLDivElement>(cancelDialog);

  function cancelDialog() {
    requestExit(onCancel);
  }

  function confirmDialog() {
    requestExit(onConfirm);
  }

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlockScroll = lockBodyScroll();
    window.requestAnimationFrame(() => cancelRef.current?.focus());

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestExit(() => onCancelRef.current());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockScroll();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [open, requestExit]);

  if (!open) return null;

  return (
    <div ref={backdropRef} className="confirmation-backdrop" role="presentation" onMouseDown={cancelDialog}>
      <div
        ref={dialogRef}
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirmation-header">
          <h2 id="confirmation-title">{title}</h2>
          <button type="button" onClick={cancelDialog} aria-label="关闭确认框"><X size={17} /></button>
        </div>
        <p id="confirmation-message">{message}</p>
        <div className="confirmation-actions">
          <button ref={cancelRef} type="button" className="button secondary" onClick={cancelDialog}>{cancelLabel}</button>
          <button type="button" className={`button ${tone === "danger" ? "danger" : "primary"}`} onClick={confirmDialog}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

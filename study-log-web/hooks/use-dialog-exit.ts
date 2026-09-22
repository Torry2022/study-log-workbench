"use client";

import { useCallback, useEffect, useRef } from "react";

const DIALOG_EXIT_DURATION_MS = 160;
const modalStack: HTMLElement[] = [];
const inertLocks = new WeakMap<HTMLElement, { count: number; previous: boolean }>();
let lastPointerControl: HTMLElement | null = null;
let interactionSubscribers = 0;
let bodyScrollLocks = 0;
let previousBodyOverflow = "";

/** Nested dialogs may unmount in either order, especially on session expiry. */
export function lockBodyScroll(): () => void {
  if (bodyScrollLocks++ === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--bodyScrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
  };
}

function rememberPointerControl(event: PointerEvent) {
  lastPointerControl = event.target instanceof Element
    ? event.target.closest<HTMLElement>('button, summary, a[href], input, select, textarea, [tabindex]')
    : null;
}

function clearPointerControl() { lastPointerControl = null; }

export function containModalFocus(container: HTMLElement, onEscape?: () => void) {
  container.inert = false;
  // WebKit does not focus a button when it is tapped; remember the actual opener.
  const previousFocus = lastPointerControl?.isConnected && !container.contains(lastPointerControl)
    ? lastPointerControl
    : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const isolated: HTMLElement[] = [];
  let branch: HTMLElement = container;
  while (branch.parentElement && branch !== document.body) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement && !sibling.classList.contains("mobile-overlay-backdrop")) {
        const lock = inertLocks.get(sibling) || { count: 0, previous: sibling.inert };
        lock.count++; inertLocks.set(sibling, lock); isolated.push(sibling);
        sibling.inert = true;
      }
    }
    branch = branch.parentElement;
  }
  modalStack.push(container);
  const focusable = () => Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  )).filter(element => element.getClientRects().length && !element.closest('[inert]'));
  const frame = requestAnimationFrame(() => {
    if (!container.contains(document.activeElement)) focusable()[0]?.focus({ preventScroll: true });
  });
  function keydown(event: KeyboardEvent) {
    if (modalStack.at(-1) !== container) return;
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const elements = focusable();
      const current = elements.indexOf(document.activeElement as HTMLElement);
      const next = (current + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
      elements[next]?.focus();
    }
  }
  document.addEventListener("keydown", keydown, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cancelAnimationFrame(frame);
    document.removeEventListener("keydown", keydown, true);
    modalStack.splice(modalStack.indexOf(container), 1);
    for (const element of isolated) {
      const lock = inertLocks.get(element)!;
      if (--lock.count === 0) { element.inert = lock.previous; inertLocks.delete(element); }
    }
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]') &&
        (!modalStack.length || modalStack.at(-1)?.contains(previousFocus))) previousFocus.focus({ preventScroll: true });
  };
}

export function useDialogExit<T extends HTMLElement = HTMLDivElement>(onEscape?: () => void) {
  useEffect(() => {
    if (interactionSubscribers++ === 0) {
      document.addEventListener("pointerdown", rememberPointerControl, true);
      document.addEventListener("keydown", clearPointerControl, true);
    }
    return () => {
      if (--interactionSubscribers === 0) {
        document.removeEventListener("pointerdown", rememberPointerControl, true);
        document.removeEventListener("keydown", clearPointerControl, true);
        lastPointerControl = null;
      }
    };
  }, []);
  const nodeRef = useRef<T | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const backdropRef = useCallback((node: T | null) => {
    releaseRef.current?.();
    nodeRef.current = node;
    releaseRef.current = node ? containModalFocus(node, () => escapeRef.current?.()) : null;
  }, []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const requestExit = useCallback((afterExit: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    nodeRef.current?.classList.add("dialog-exiting");

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timerRef.current = setTimeout(() => {
      closingRef.current = false;
      timerRef.current = null;
      afterExit();
    }, reducedMotion ? 0 : DIALOG_EXIT_DURATION_MS);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { backdropRef, requestExit };
}

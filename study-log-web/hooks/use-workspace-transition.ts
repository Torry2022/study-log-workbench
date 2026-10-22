"use client";

import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

export type WorkspaceTransitionKind =
  | "workspace"
  | "log-document"
  | "log-mode"
  | "detail"
  | "result"
  | "overlay";

type TransitionOptions = {
  waitForReady?: boolean;
};

type ViewTransition = { finished: Promise<void>; skipTransition?: () => void };
type TransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransition;
};

const READY_DEADLINE_MS = 200;

export function supportsStableViewTransitions(transitionDocument: TransitionDocument): boolean {
  if (!transitionDocument.startViewTransition) return false;
  const userAgent = navigator.userAgent;
  return !/AppleWebKit/i.test(userAgent) || /(Chrome|Chromium|Edg)/i.test(userAgent);
}

export function useWorkspaceTransition() {
  const tokenRef = useRef(0);
  const readyRef = useRef<{ token: number; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const snapshotRef = useRef<HTMLElement | null>(null);

  const finishWaiting = useCallback(() => {
    const pending = readyRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    readyRef.current = null;
    pending.resolve();
  }, []);

  const completeTransition = useCallback(() => finishWaiting(), [finishWaiting]);

  const cancelTransition = useCallback(() => {
    tokenRef.current++;
    finishWaiting();
    snapshotRef.current?.remove();
    snapshotRef.current = null;
    document.querySelectorAll<HTMLElement>("[data-workspace-transition-surface]").forEach(surface => {
      surface.classList.remove("workspace-content-waiting", "workspace-content-revealing", "workspace-position-revealing");
    });
    delete document.documentElement.dataset.workspaceTransition;
  }, [finishWaiting]);

  const runTransition = useCallback((
    kind: WorkspaceTransitionKind,
    update: () => void,
    options: TransitionOptions = {}
  ) => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cancelTransition();
    const token = tokenRef.current;

    let resolveApplied!: (applied: boolean) => void;
    const applied = new Promise<boolean>((resolve) => { resolveApplied = resolve; });
    const applyUpdate = () => {
      if (tokenRef.current !== token) { resolveApplied(false); return false; }
      flushSync(update);
      resolveApplied(true);
      return true;
    };
    if (reducedMotion) {
      delete document.documentElement.dataset.workspaceTransition;
      applyUpdate();
      return applied;
    }

    document.documentElement.dataset.workspaceTransition = kind;
    const surfaceSelector = ".workspace-view:not([hidden]) [data-workspace-transition-surface], .workspace-view:not([hidden]) .reader-content, .workspace-view:not([hidden]) .rag-workspace, .workspace-view:not([hidden]) .stats-shell";
    const clearTransitionState = () => {
      if (tokenRef.current === token) delete document.documentElement.dataset.workspaceTransition;
    };
    const visibleBounds = () => {
      const shell = document.querySelector<HTMLElement>("[data-workspace-transition-shell]");
      const rect = shell?.getBoundingClientRect();
      const toolbar = shell?.querySelector<HTMLElement>(".workspace-view:not([hidden]) .reader-toolbar");
      return {
        top: Math.max(0, toolbar?.getBoundingClientRect().bottom ?? rect?.top ?? 0),
        left: Math.max(0, rect?.left ?? 0),
        right: Math.max(0, window.innerWidth - (rect?.right ?? window.innerWidth))
      };
    };

    const currentSurface = document.querySelector<HTMLElement>(surfaceSelector);
    let snapshot: HTMLElement | null = null;
    if (options.waitForReady && currentSurface) {
      const rect = currentSurface.getBoundingClientRect();
      const bounds = visibleBounds();
      snapshot = currentSurface.cloneNode(true) as HTMLElement;
      snapshot.removeAttribute("data-workspace-transition-surface");
      snapshot.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.setAttribute("inert", "");
      snapshot.classList.remove("workspace-content-revealing", "workspace-content-waiting", "workspace-position-revealing");
      snapshot.classList.add("workspace-transition-snapshot");
      Object.assign(snapshot.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        clipPath: `inset(${Math.max(0, bounds.top - rect.top)}px ${Math.max(0, rect.right - window.innerWidth + bounds.right)}px ${Math.max(0, rect.bottom - window.innerHeight)}px ${Math.max(0, bounds.left - rect.left)}px)`,
        background: getComputedStyle(currentSurface).backgroundColor
      });
      document.body.append(snapshot);
      const originals = [currentSurface, ...currentSurface.querySelectorAll<HTMLElement>("*")];
      const copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")];
      originals.forEach((element, index) => {
        copies[index].scrollTop = element.scrollTop;
        copies[index].scrollLeft = element.scrollLeft;
      });
      snapshotRef.current?.remove();
      snapshotRef.current = snapshot;
      const retainedSnapshot = snapshot;
      const updateSnapshotClip = () => {
        if (!retainedSnapshot.isConnected) return;
        const bounds = visibleBounds();
        retainedSnapshot.style.clipPath = `inset(${Math.max(0, bounds.top - rect.top)}px ${Math.max(0, rect.right - window.innerWidth + bounds.right)}px ${Math.max(0, rect.bottom - window.innerHeight)}px ${Math.max(0, bounds.left - rect.left)}px)`;
        requestAnimationFrame(updateSnapshotClip);
      };
      requestAnimationFrame(updateSnapshotClip);
    }

    applyUpdate();
    const surface = document.querySelector<HTMLElement>(surfaceSelector);
    if (!surface) {
      snapshot?.remove();
      if (snapshotRef.current === snapshot) snapshotRef.current = null;
      clearTransitionState();
      return applied;
    }

    if (snapshot) {
      surface.classList.add("workspace-content-waiting");
      const release = () => {
        surface.classList.remove("workspace-content-waiting");
        if (tokenRef.current !== token) {
          snapshot.remove();
          return;
        }
        const revealClass = kind === "log-mode" ? "workspace-position-revealing" : "workspace-content-revealing";
        surface.classList.add(revealClass);
        if (kind === "log-mode") snapshot.remove();
        else snapshot.classList.add("workspace-transition-snapshot-exiting");
        window.setTimeout(() => {
          snapshot.remove();
          if (snapshotRef.current === snapshot) snapshotRef.current = null;
          if (tokenRef.current === token) surface.classList.remove(revealClass);
          clearTransitionState();
        }, 160);
      };
      const timer = setTimeout(() => {
        if (readyRef.current?.token === token) readyRef.current = null;
        release();
      }, READY_DEADLINE_MS);
      readyRef.current = { token, resolve: release, timer };
      return applied;
    }

    surface.classList.remove("workspace-content-revealing");
    requestAnimationFrame(() => {
      if (tokenRef.current !== token) return;
      surface.classList.add("workspace-content-revealing");
      surface.addEventListener("animationend", () => {
        surface.classList.remove("workspace-content-revealing");
        clearTransitionState();
      }, { once: true });
    });
    return applied;
  }, [cancelTransition]);

  useEffect(() => cancelTransition, [cancelTransition]);

  return { runTransition, completeTransition, cancelTransition };
}

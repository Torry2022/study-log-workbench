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

function supportsStableViewTransitions(transitionDocument: TransitionDocument): boolean {
  if (!transitionDocument.startViewTransition) return false;
  const userAgent = navigator.userAgent;
  return !/AppleWebKit/i.test(userAgent) || /(Chrome|Chromium|Edg)/i.test(userAgent);
}

export function useWorkspaceTransition() {
  const tokenRef = useRef(0);
  const readyRef = useRef<{ token: number; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const snapshotRef = useRef<HTMLElement | null>(null);
  const nativeTransitionRef = useRef<{ transition: ViewTransition; restoreNames: () => void } | null>(null);

  const finishWaiting = useCallback(() => {
    const pending = readyRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    readyRef.current = null;
    pending.resolve();
  }, []);

  const completeTransition = useCallback(() => finishWaiting(), [finishWaiting]);

  const runTransition = useCallback((
    kind: WorkspaceTransitionKind,
    update: () => void,
    options: TransitionOptions = {}
  ) => {
    const transitionDocument = document as TransitionDocument;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    finishWaiting();
    const previousNativeTransition = nativeTransitionRef.current;
    if (previousNativeTransition) {
      nativeTransitionRef.current = null;
      previousNativeTransition.transition.skipTransition?.();
      previousNativeTransition.restoreNames();
    }

    const applyUpdate = () => flushSync(update);
    if (reducedMotion) {
      applyUpdate();
      return;
    }

    document.documentElement.dataset.workspaceTransition = kind;
    const surfaceSelector = kind === "workspace" || kind === "log-document"
      ? "[data-workspace-transition-shell]"
      : "[data-workspace-transition-surface]";
    const clearTransitionState = () => {
      if (tokenRef.current === token) delete document.documentElement.dataset.workspaceTransition;
    };

    if (supportsStableViewTransitions(transitionDocument)) {
      const namedSurface = document.querySelector<HTMLElement>(surfaceSelector);
      const nestedContent = namedSurface?.matches("[data-workspace-transition-shell]")
        ? namedSurface.querySelector<HTMLElement>("[data-workspace-transition-surface]")
        : null;
      const previousSurfaceName = namedSurface?.style.viewTransitionName || "";
      const previousContentName = nestedContent?.style.viewTransitionName || "";
      if (namedSurface) namedSurface.style.viewTransitionName = "workspace-content";
      if (nestedContent) nestedContent.style.viewTransitionName = "none";
      const restoreTransitionNames = () => {
        if (namedSurface) namedSurface.style.viewTransitionName = previousSurfaceName;
        if (nestedContent) nestedContent.style.viewTransitionName = previousContentName;
      };
      try {
        const transition = transitionDocument.startViewTransition!(() => {
          applyUpdate();
          if (!options.waitForReady) return;
          return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              if (readyRef.current?.token === token) readyRef.current = null;
              resolve();
            }, READY_DEADLINE_MS);
            readyRef.current = { token, resolve, timer };
          });
        });
        nativeTransitionRef.current = { transition, restoreNames: restoreTransitionNames };
        void transition.finished.finally(() => {
          if (nativeTransitionRef.current?.transition === transition) nativeTransitionRef.current = null;
          restoreTransitionNames();
          clearTransitionState();
        });
        return;
      } catch {
        restoreTransitionNames();
        clearTransitionState();
      }
    }

    const currentSurface = document.querySelector<HTMLElement>(surfaceSelector);
    let snapshot: HTMLElement | null = null;
    if (options.waitForReady && currentSurface) {
      const rect = currentSurface.getBoundingClientRect();
      snapshot = currentSurface.cloneNode(true) as HTMLElement;
      snapshot.removeAttribute("data-workspace-transition-surface");
      snapshot.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.setAttribute("inert", "");
      snapshot.classList.remove("workspace-content-revealing", "workspace-content-waiting");
      snapshot.classList.add("workspace-transition-snapshot");
      Object.assign(snapshot.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        background: getComputedStyle(currentSurface).backgroundColor
      });
      document.body.append(snapshot);
      snapshotRef.current?.remove();
      snapshotRef.current = snapshot;
    }

    applyUpdate();
    const surface = document.querySelector<HTMLElement>(surfaceSelector);
    if (!surface) {
      snapshot?.remove();
      if (snapshotRef.current === snapshot) snapshotRef.current = null;
      clearTransitionState();
      return;
    }

    if (snapshot) {
      surface.classList.add("workspace-content-waiting");
      const release = () => {
        surface.classList.remove("workspace-content-waiting");
        if (tokenRef.current !== token) {
          snapshot.remove();
          return;
        }
        surface.classList.add("workspace-content-revealing");
        snapshot.classList.add("workspace-transition-snapshot-exiting");
        window.setTimeout(() => {
          snapshot.remove();
          if (snapshotRef.current === snapshot) snapshotRef.current = null;
          surface.classList.remove("workspace-content-revealing");
          clearTransitionState();
        }, 160);
      };
      const timer = setTimeout(() => {
        if (readyRef.current?.token === token) readyRef.current = null;
        release();
      }, READY_DEADLINE_MS);
      readyRef.current = { token, resolve: release, timer };
      return;
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
  }, [finishWaiting]);

  useEffect(() => () => {
    finishWaiting();
    nativeTransitionRef.current?.transition.skipTransition?.();
    nativeTransitionRef.current?.restoreNames();
    nativeTransitionRef.current = null;
    snapshotRef.current?.remove();
    snapshotRef.current = null;
  }, [finishWaiting]);

  return { runTransition, completeTransition };
}

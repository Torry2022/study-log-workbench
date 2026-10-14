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

    // Document and mode changes restore the reading anchor after rendering.
    // Native snapshots freeze viewport positions while that scroll settles.
    const restoresReadingPosition = kind === "log-document" || kind === "log-mode";
    if (!restoresReadingPosition && supportsStableViewTransitions(transitionDocument)) {
      const namedSurface = document.querySelector<HTMLElement>(surfaceSelector);
      const previousNames = new Map<HTMLElement, string>();
      const nameSurface = (surface: HTMLElement | null) => {
        if (!surface || previousNames.has(surface)) return;
        previousNames.set(surface, surface.style.viewTransitionName);
        surface.style.viewTransitionName = "workspace-content";
      };
      nameSurface(namedSurface);
      let namesRestored = false;
      const restoreTransitionNames = () => {
        if (namesRestored) return;
        namesRestored = true;
        previousNames.forEach((name, surface) => { surface.style.viewTransitionName = name; });
      };
      let clipFrame = 0;
      const updateClip = () => {
        if (tokenRef.current !== token) return;
        const bounds = visibleBounds();
        // Native snapshots paint above sticky controls. Clip in the animated
        // group's coordinates while scroll restoration changes its position.
        const surfaceRect = namedSurface?.getBoundingClientRect();
        const group = getComputedStyle(document.documentElement, "::view-transition-group(workspace-content)");
        const transform = group.transform !== "none" ? new DOMMatrix(group.transform) : null;
        const left = transform?.m41 ?? surfaceRect?.left ?? 0;
        const top = transform?.m42 ?? surfaceRect?.top ?? 0;
        const width = parseFloat(group.width) || surfaceRect?.width || 0;
        const height = parseFloat(group.height) || surfaceRect?.height || 0;
        const style = document.documentElement.style;
        style.setProperty("--workspace-transition-top", `${Math.max(0, bounds.top - top)}px`);
        style.setProperty("--workspace-transition-left", `${Math.max(0, bounds.left - left)}px`);
        style.setProperty("--workspace-transition-right", `${Math.max(0, left + width - window.innerWidth + bounds.right)}px`);
        style.setProperty("--workspace-transition-bottom", `${Math.max(0, top + height - window.innerHeight)}px`);
        clipFrame = requestAnimationFrame(updateClip);
      };
      updateClip();
      try {
        const transition = transitionDocument.startViewTransition!(() => {
          if (!applyUpdate()) return;
          // Public module slots keep separate bodies mounted. Name the newly
          // visible body too, rather than capturing a hidden log surface.
          nameSurface(document.querySelector<HTMLElement>(surfaceSelector));
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
          cancelAnimationFrame(clipFrame);
          resolveApplied(false);
          if (nativeTransitionRef.current?.transition === transition) nativeTransitionRef.current = null;
          restoreTransitionNames();
          clearTransitionState();
        }).catch(() => {});
        return applied;
      } catch {
        cancelAnimationFrame(clipFrame);
        restoreTransitionNames();
        clearTransitionState();
      }
    }

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
      snapshot.classList.remove("workspace-content-revealing", "workspace-content-waiting");
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

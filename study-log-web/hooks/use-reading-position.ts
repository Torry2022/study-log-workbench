"use client";

import { useCallback, useRef } from "react";
import { captureReadingPosition, restoreReadingPosition, type ReadingAnchor, type ReadingMode, type ReadingPositionOptions } from "@/lib/reading-position";

// Capture immediately before the layout change; restore after the new layout
// is visible (normally the next animation frame). False allows a bounded retry
// when the target has not mounted yet. This hook owns no scroll listeners.
export function useReadingPosition(options: ReadingPositionOptions) {
  const current = useRef(options);
  current.current = options;
  const anchor = useRef<ReadingAnchor | null>(null);
  const capture = useCallback((mode: ReadingMode) => {
    anchor.current = captureReadingPosition(current.current, mode);
  }, []);
  const restore = useCallback((mode: ReadingMode) => {
    return anchor.current ? restoreReadingPosition(current.current, anchor.current, mode) : false;
  }, []);
  return { capture, restore };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmationOptions } from "@/components/ConfirmDialog";

type PendingConfirmation = ConfirmationOptions & { open: true };

export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => () => { resolverRef.current?.(false); resolverRef.current = null; }, []);

  const confirm = useCallback((options: ConfirmationOptions) => {
    resolverRef.current?.(false);
    setConfirmation({ ...options, open: true });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setConfirmation(null);
  }, []);

  return { confirmation, confirm, resolveConfirmation };
}

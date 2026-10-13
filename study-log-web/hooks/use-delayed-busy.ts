"use client";

import { useEffect, useState } from "react";

export function useDelayedBusy(busy: boolean, delay = 200) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [busy, delay]);

  return visible;
}

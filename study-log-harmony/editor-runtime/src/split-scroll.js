// One-way publication from the active pane. Incoming scrolls remain silent until
// the user takes control, so asynchronous Web scroll events cannot echo back.
export function createSplitScroll({ read, write, publish, frame, cancel }) {
  let key = '', enabled = false, muted = false, pending = null;
  function cancelPending() { if (pending !== null) cancel(pending); pending = null; }
  return {
    configure(nextKey, nextEnabled) {
      if (key === nextKey && enabled === nextEnabled) return;
      cancelPending(); key = nextKey; enabled = nextEnabled; muted = true;
    },
    intent() { muted = false; },
    scroll() {
      if (!enabled || muted || pending !== null) return;
      const current = key;
      pending = frame(() => {
        pending = null;
        if (!enabled || muted || key !== current) return;
        const { offset, range } = read();
        // A non-scrollable pane cannot drive its peer back to the beginning.
        if (range > 0) publish(key, Math.max(0, Math.min(1, offset / range)));
      });
    },
    apply(packet) {
      if (!enabled || packet.key !== key || !Number.isFinite(packet.progress)) return;
      cancelPending(); muted = true;
      const { range } = read();
      write(Math.max(0, Math.min(1, packet.progress)) * Math.max(0, range));
    }
  };
}

if (typeof window !== 'undefined') window.createSplitScroll = createSplitScroll;

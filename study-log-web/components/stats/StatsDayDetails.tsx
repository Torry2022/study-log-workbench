"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { StatsEntry } from "@/lib/stats-types";

export function StatsEntryList({ entries, showDate = true, onOpenEntry }: {
  entries: StatsEntry[]; showDate?: boolean; onOpenEntry: (entry: StatsEntry) => void;
}) {
  return <div className="stats-drilldown-list">
    {entries.map(entry => <button key={`${entry.date}-${entry.headingIndex}-${entry.rawHeading}`} type="button"
      className={showDate ? "stats-entry" : "stats-entry without-date"} onClick={() => onOpenEntry(entry)}>
      {showDate && <time>{entry.date}</time>}
      <div className="stats-entry-main"><strong>{entry.headingText}</strong><small>{entry.domain}</small></div>
      <ChevronRight size={14} aria-hidden="true" />
    </button>)}
  </div>;
}

export function StatsDayDetails({ date, entries, anchor, onClose, onOpenEntry }: {
  date: string; entries: StatsEntry[]; anchor: HTMLButtonElement;
  onClose: () => void; onOpenEntry: (entry: StatsEntry) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [position, setPosition] = useState<{ top?: number; left?: number }>({});

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    const place = () => {
      if (window.innerWidth < 840) { setPosition({}); return; }
      const target = anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
      const below = target.bottom + 8;
      const top = below + bounds.height <= window.innerHeight - 12 ? below : target.top - bounds.height - 8;
      setPosition({ top: Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12)),
        left: Math.max(12, Math.min(target.left, window.innerWidth - bounds.width - 12)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      panel.close();
    };
  }, [anchor]);

  return <dialog ref={dialog} className="stats-day-dialog" style={position} aria-label={`${date} 日志小节`}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className="stats-day-heading"><div><h3>{date}</h3><p>{entries.length} 个日志小节</p></div>
      <button type="button" className="icon-button" aria-label="关闭日期明细" onClick={onClose}><X size={16} /></button>
    </div>
    <div className="stats-day-entries">
      <StatsEntryList entries={entries} showDate={false} onOpenEntry={entry => { onClose(); onOpenEntry(entry); }} />
      {!entries.length && <p className="stats-day-empty">当天暂无可统计的小节</p>}
    </div>
  </dialog>;
}

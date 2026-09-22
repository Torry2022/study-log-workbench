"use client";

import { useMemo, useRef, useState } from "react";
import { buildDiffRows, type DiffSide } from "@/lib/backup-diff";
import "@/app/backup.css";

interface BackupDiffViewerProps {
  currentContent: string;
  historicalContent: string;
  historicalLabel: string;
}

function DiffContent({ side, tone }: { side: DiffSide | null; tone: "current" | "historical" }) {
  return (
    <div className={`backup-diff-cell ${tone}`} role="cell">
      <span className="backup-diff-line-number">{side?.lineNumber || ""}</span>
      <code>
        {side ? (
          side.segments?.length ? side.segments.map((segment, index) => (
            <mark className={segment.changed ? "changed" : ""} key={`${index}-${segment.value}`}>{segment.value}</mark>
          )) : (side.text || "\u00a0")
        ) : "\u00a0"}
      </code>
    </div>
  );
}

export function BackupDiffViewer({ currentContent, historicalContent, historicalLabel }: BackupDiffViewerProps) {
  const [side, setSide] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const positions = useRef([0, 0]);
  function switchSide(next: number) {
    if (scrollRef.current) positions.current[side] = scrollRef.current.scrollTop;
    setSide(next);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = positions.current[next]; });
  }
  const rows = useMemo(
    () => buildDiffRows(currentContent, historicalContent),
    [currentContent, historicalContent]
  );

  return (
    <div className="backup-diff-viewer" data-side={side}>
      <div className="version-switch view-mode-switch" role="group" aria-label="查看版本">
        {["当前内容", "历史内容"].map((label, index) => (
          <button key={label} type="button" className={`view-mode-button${side === index ? " active" : ""}`} aria-pressed={side === index} onClick={() => switchSide(index)}>{label}</button>
        ))}
      </div>
      <header className="backup-diff-header">
        <div><strong>当前内容</strong><span>恢复后被替换</span></div>
        <div><strong>历史内容</strong><span>{historicalLabel}</span></div>
      </header>
      <div ref={scrollRef} className="backup-diff-scroll" role="table" aria-label="当前内容与历史内容差异">
        {rows.map((row, index) => (
          <div className={`backup-diff-row ${row.kind}`} role="row" key={`${index}-${row.current?.lineNumber || 0}-${row.historical?.lineNumber || 0}`}>
            <DiffContent side={row.current} tone="current" />
            <DiffContent side={row.historical} tone="historical" />
          </div>
        ))}
      </div>
    </div>
  );
}

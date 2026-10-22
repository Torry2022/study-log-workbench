"use client";

import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import "@/app/sidebar-filters.css";

export function SidebarFilterHeading({ title, filtered, onReset, onCollapse, collapseLabel = "折叠左侧栏" }: {
  title: ReactNode;
  filtered: boolean;
  onReset: () => void;
  onCollapse?: () => void;
  collapseLabel?: string;
}) {
  return (
    <div className="sidebar-heading sidebar-filter-heading">
      <div className="section-title inline">{title}</div>
      <div className="sidebar-filter-heading-actions">
        <button className="sidebar-filter-reset" type="button" style={{ visibility: filtered ? "visible" : "hidden" }} disabled={!filtered} onClick={onReset}>
          重置筛选
        </button>
        {onCollapse && <button className="sidebar-collapse-button" type="button" onClick={onCollapse} title={collapseLabel} aria-label={collapseLabel}><ChevronLeft size={16} /></button>}
      </div>
    </div>
  );
}

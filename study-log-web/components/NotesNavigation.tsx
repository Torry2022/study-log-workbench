"use client";

import { CalendarDays, Download, Plus, Tag } from "lucide-react";
import type { NotesController } from "@/hooks/use-notes";
import "@/app/notes.css";

export function NotesNavigation({ notes, onNavigate, onExport, exportBusy = false, filtersOnly = false }: { notes: NotesController; onNavigate?: () => void; onExport?: () => void; exportBusy?: boolean; filtersOnly?: boolean }) {
  return <div className="module-sidebar-content notes-sidebar-content">
    {!filtersOnly && <div className="sidebar-section notes-sidebar-primary"><button className="button secondary full notes-new-button" type="button" disabled={notes.saving} onClick={async () => { if (await notes.openNew()) onNavigate?.(); }}><Plus size={15} />新建随记</button>
      {onExport && <button className="button secondary full notes-export-mobile" type="button" disabled={exportBusy} onClick={() => { onExport(); onNavigate?.(); }}><Download size={15} />导出全部随记</button>}</div>}
    <div className="sidebar-section notes-filter-section"><div className="section-title"><span><CalendarDays size={15} />年份</span></div>
      <div className="notes-filter-list">{[{ value: "all", count: notes.notes.length }, ...notes.years].map(year => <button className={`nav-item${notes.yearFilter === year.value ? " active" : ""}`} type="button" key={year.value} onClick={() => { notes.setYearFilter(year.value); onNavigate?.(); }}><span>{year.value === "all" ? "全部" : year.value}</span><small>{year.count}</small></button>)}</div>
    </div>
    <div className="sidebar-section notes-filter-section"><div className="section-title notes-tags-heading"><span><Tag size={15} />标签</span></div>
      <div className="notes-tag-filter-list"><button className={notes.tagFilter === "all" ? "active" : ""} type="button" onClick={() => { notes.setTagFilter("all"); onNavigate?.(); }}>全部标签</button>{notes.tags.map(tag => <button className={notes.tagFilter === tag.value ? "active" : ""} type="button" key={tag.value} onClick={() => { notes.setTagFilter(tag.value); onNavigate?.(); }}><span>{tag.value}</span><small>{tag.count}</small></button>)}</div>
    </div>
  </div>;
}

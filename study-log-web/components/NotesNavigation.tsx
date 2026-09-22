"use client";

import { CalendarDays, Plus, Tag, X } from "lucide-react";
import type { NotesController } from "@/hooks/use-notes";
import "@/app/notes.css";

export function NotesNavigation({ notes, onNavigate }: { notes: NotesController; onNavigate?: () => void }) {
  return <div className="module-sidebar-content notes-sidebar-content">
    <button className="button primary notes-new-button" type="button" disabled={notes.saving} onClick={async () => { if (await notes.openNew()) onNavigate?.(); }}><Plus size={15} />新建随记</button>
    {(notes.yearFilter !== "all" || notes.tagFilter !== "all") && <button className="notes-clear-filters" type="button" onClick={notes.clearFilters}><X size={13} />清除筛选</button>}
    <div className="sidebar-section notes-filter-section"><div className="section-title"><span><CalendarDays size={15} />年份</span></div>
      <div className="notes-filter-list">{[{ value: "all", count: notes.notes.length }, ...notes.years].map(year => <button className={`nav-item${notes.yearFilter === year.value ? " active" : ""}`} type="button" key={year.value} onClick={() => { notes.setYearFilter(year.value); onNavigate?.(); }}><span>{year.value === "all" ? "全部" : year.value}</span><small>{year.count}</small></button>)}</div>
    </div>
    <div className="sidebar-section notes-filter-section"><div className="section-title notes-tags-heading"><span><Tag size={15} />标签</span></div>
      <div className="notes-tag-filter-list"><button className={notes.tagFilter === "all" ? "active" : ""} type="button" onClick={() => { notes.setTagFilter("all"); onNavigate?.(); }}>全部标签</button>{notes.tags.map(tag => <button className={notes.tagFilter === tag.value ? "active" : ""} type="button" key={tag.value} onClick={() => { notes.setTagFilter(tag.value); onNavigate?.(); }}><span>{tag.value}</span><small>{tag.count}</small></button>)}</div>
    </div>
  </div>;
}

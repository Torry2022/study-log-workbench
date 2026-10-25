"use client";

type SidebarMonth = { id: string; label: string; count: number };
type SidebarMonthGroupsProps = {
  months: readonly SidebarMonth[];
  selectedMonth: string;
  onMonthChange: (month: string) => void;
};

export function SidebarMonthGroups({ months, selectedMonth, onMonthChange }: SidebarMonthGroupsProps) {
  return <>{[...months].sort((a, b) => b.id.localeCompare(a.id)).map(month => (
    <button type="button" key={month.id} className={selectedMonth === month.id ? "nav-item active" : "nav-item"}
      aria-current={selectedMonth === month.id ? "true" : undefined} onClick={() => onMonthChange(month.id)}>
      <span>{month.label}</span><small>{month.count}</small>
    </button>
  ))}</>;
}

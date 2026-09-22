export interface MonthSummary {
  id: string;
  label: string;
  dayCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface DaySummary {
  date: string;
  month: string;
  fileName: string;
  headings: string[];
  preview: string;
}

export interface DayEntry extends DaySummary {
  exists: boolean;
  content: string;
  version: string | null;
  updatedAt: string | null;
}

export interface SaveDayInput {
  date: string;
  content: string;
  baseVersion: string | null;
  mode?: "replace" | "append";
}

export interface DeleteDayInput {
  date: string;
  baseVersion: string;
}

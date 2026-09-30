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

export interface MonthsResponse { months: MonthSummary[]; }
export interface DaysResponse { days: DaySummary[]; }
export interface DayResponse { day: DayEntry; }

export interface SaveDayRequest {
  date: string;
  content: string;
  baseVersion: string | null;
}

export interface DeleteDayRequest {
  date: string;
  baseVersion: string;
}

export interface LogSourceTarget {
  query?: string;
  date: string;
  heading: string;
  headingIndex: number;
  headingId: string;
  kind: string;
}

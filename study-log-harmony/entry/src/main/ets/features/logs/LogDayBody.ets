import { DayEntry } from './LogModels';

export function editableDayBodyFromContent(content: string): string {
  return content.trimEnd().replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, '')
    .replace(/^##\s+\d{4}-\d{2}-\d{2}\s*\n?/, '').replace(/^\r?\n+/, '').trimEnd();
}

export function editableDayBody(day: DayEntry): string { return editableDayBodyFromContent(day.content); }

export function matchesSubmittedDay(day: DayEntry, submittedText: string): boolean {
  return day.exists && !!day.version && editableDayBody(day) === submittedText;
}

export function matchesDeletedDay(day: DayEntry, date: string): boolean {
  return day.date === date && !day.exists;
}

export function matchesRestoredContent(day: DayEntry, date: string, historicalContent: string): boolean {
  return day.date === date && day.exists && !!day.version &&
    editableDayBody(day) === editableDayBodyFromContent(historicalContent);
}

import { DayEntry } from './LogModels';

export function editableDayBody(day: DayEntry): string {
  return day.content.trimEnd().replace(/(?:\r?\n)+[ \t]*---[ \t]*$/, '')
    .replace(/^##\s+\d{4}-\d{2}-\d{2}\s*\n?/, '').replace(/^\r?\n+/, '').trimEnd();
}

export function matchesSubmittedDay(day: DayEntry, submittedText: string): boolean {
  return day.exists && !!day.version && editableDayBody(day) === submittedText;
}

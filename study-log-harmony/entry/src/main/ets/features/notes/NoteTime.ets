export function beijingNoteTimestamp(now: number = Date.now()): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) + ':00+08:00';
}

// Native pickers read local date fields; pass Beijing wall time without reinterpreting its offset.
export function notePickerDate(value: string): Date {
  return new Date(value.slice(0, 19));
}

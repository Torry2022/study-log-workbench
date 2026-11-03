/** Normalize source heading spelling; callers retain their calendar-validation policy. */
export function normalizeLogHeadingDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
}

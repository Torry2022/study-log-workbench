export function headingTextOf(rawHeading: string): string {
  return rawHeading.replace(/^ {0,3}###(?!#)\s+/, "")
    .replace(/^\s*\d+(?:\.\d+)*(?:[.)．]\s+|、\s*)/, "").trim().replace(/\s+/g, " ");
}

/** Retain the existing topic grouping: omit optional numbering and parenthetical qualifiers. */
export function normalizeHeading(rawHeading: string): string {
  let value = headingTextOf(rawHeading);
  let next = value.replace(/[（(][^()（）]*[）)]/g, "").trim();
  while (next !== value) { value = next; next = value.replace(/[（(][^()（）]*[）)]/g, "").trim(); }
  return value.replace(/\s+/g, " ");
}

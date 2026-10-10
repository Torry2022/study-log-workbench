export function headingTextOf(rawHeading: string): string {
  return rawHeading.replace(/^ {0,3}###(?!#)\s+/, "")
    .replace(/^\s*\d+(?:\.\d+)*(?:[.)．]\s+|、\s*)/, "").trim().replace(/\s+/g, " ");
}

/** Topic identity retains qualifiers; optional section numbering is presentation only. */
export function normalizeHeading(rawHeading: string): string {
  return headingTextOf(rawHeading);
}

/** Older saved mappings grouped all parenthetical variants under one key. */
function legacyHeading(rawHeading: string): string {
  let value = headingTextOf(rawHeading);
  let next = value.replace(/[（(][^()（）]*[）)]/g, "").trim();
  while (next !== value) { value = next; next = value.replace(/[（(][^()（）]*[）)]/g, "").trim(); }
  return value.replace(/\s+/g, " ");
}

export function taxonomyMapping(mappings: Record<string, string>, tag: string): string | undefined {
  if (Object.hasOwn(mappings, tag)) return mappings[tag];
  const legacy = legacyHeading(tag);
  return Object.hasOwn(mappings, legacy) ? mappings[legacy] : undefined;
}

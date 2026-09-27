export interface PreservedLogDraft {
  namespace: string;
  date: string;
  text: string;
  baseVersion: string | null;
}

export function parseLogDraft(raw: string, namespace: string): PreservedLogDraft | undefined {
  try {
    const draft = JSON.parse(raw) as PreservedLogDraft;
    if (!draft || draft.namespace !== namespace ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
      typeof draft.text !== 'string' ||
      !(draft.baseVersion === null || typeof draft.baseVersion === 'string')) return undefined;
    return draft;
  } catch (_) { return undefined; }
}

export function restoredLogDraft(draft: PreservedLogDraft | undefined, namespace: string,
  date: string, serverText: string, serverVersion: string | null):
  { text: string; conflict: boolean } | undefined {
  if (!draft || draft.namespace !== namespace || draft.date !== date || draft.text === serverText) return undefined;
  return { text: draft.text, conflict: draft.baseVersion !== serverVersion };
}

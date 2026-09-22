import { diffLines, diffWordsWithSpace, type Change } from "diff";

type DiffRowKind = "unchanged" | "changed" | "removed" | "added";

interface DiffSegment {
  value: string;
  changed: boolean;
}

export interface DiffSide {
  lineNumber: number;
  text: string;
  segments?: DiffSegment[];
}

interface DiffRow {
  kind: DiffRowKind;
  current: DiffSide | null;
  historical: DiffSide | null;
}

function splitChangeLines(value: string): string[] {
  if (!value) return [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (value.endsWith("\n")) lines.pop();
  return lines;
}

function buildSegments(current: string, historical: string): { current: DiffSegment[]; historical: DiffSegment[] } {
  const changes = diffWordsWithSpace(current, historical);
  return {
    current: changes
      .filter((change) => !change.added)
      .map((change) => ({ value: change.value, changed: Boolean(change.removed) })),
    historical: changes
      .filter((change) => !change.removed)
      .map((change) => ({ value: change.value, changed: Boolean(change.added) }))
  };
}

export function buildDiffRows(currentContent: string, historicalContent: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let currentLine = 1;
  let historicalLine = 1;
  let removed: string[] = [];
  let added: string[] = [];

  const flushChangedLines = () => {
    const rowCount = Math.max(removed.length, added.length);
    for (let index = 0; index < rowCount; index += 1) {
      const currentText = removed[index];
      const historicalText = added[index];
      const paired = currentText !== undefined && historicalText !== undefined;
      const segments = paired ? buildSegments(currentText, historicalText) : null;
      rows.push({
        kind: paired ? "changed" : currentText !== undefined ? "removed" : "added",
        current: currentText === undefined
          ? null
          : { lineNumber: currentLine++, text: currentText, segments: segments?.current },
        historical: historicalText === undefined
          ? null
          : { lineNumber: historicalLine++, text: historicalText, segments: segments?.historical }
      });
    }
    removed = [];
    added = [];
  };

  diffLines(currentContent, historicalContent).forEach((change: Change) => {
    const lines = splitChangeLines(change.value);
    if (change.removed) {
      removed.push(...lines);
      return;
    }
    if (change.added) {
      added.push(...lines);
      return;
    }
    flushChangedLines();
    lines.forEach((text) => {
      rows.push({
        kind: "unchanged",
        current: { lineNumber: currentLine++, text },
        historical: { lineNumber: historicalLine++, text }
      });
    });
  });
  flushChangedLines();

  return rows;
}

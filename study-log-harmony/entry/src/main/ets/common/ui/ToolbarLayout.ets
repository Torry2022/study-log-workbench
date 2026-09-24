import measure from '@ohos.measure';

export enum ToolbarDensity {
  OVERFLOW = 0,
  COMPACT = 1,
  FULL = 2
}

export function toolbarActionWidth(label: string, showLabel: boolean = true): number {
  if (!showLabel) return 40;
  const textWidth = px2vp(measure.measureText({
    textContent: label, fontSize: 12, fontWeight: '500', fontFamily: 'HarmonyOS Sans SC'
  }));
  return Math.max(40, Math.ceil(textWidth) + 44);
}

export function toolbarActionsWidth(labels: string[]): number {
  return labels.reduce((width: number, label: string) => width + toolbarActionWidth(label), 0) +
    Math.max(0, labels.length - 1) * 8;
}

// Upgrade with a small margin; downgrade before controls can overlap.
export function resolveToolbarDensity(width: number, compactWidth: number, fullWidth: number,
  current: ToolbarDensity): ToolbarDensity {
  if (width >= fullWidth + (current === ToolbarDensity.FULL ? 0 : 12)) return ToolbarDensity.FULL;
  if (width >= compactWidth + (current === ToolbarDensity.OVERFLOW ? 12 : 0)) return ToolbarDensity.COMPACT;
  return ToolbarDensity.OVERFLOW;
}

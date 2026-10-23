// Month navigation follows the workspace calendar year in Asia/Shanghai.
export function currentShanghaiYear(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCFullYear().toString();
}

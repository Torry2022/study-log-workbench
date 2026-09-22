export const APP_BASE_PATH = "/study-log";

export function withBasePath(path: string): string {
  if (!path || /^(https?:|data:|blob:)/i.test(path)) return path;
  return `${APP_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

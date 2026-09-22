import path from "node:path";

export const LOG_FILE_PATTERN = /^(\d{4})(?:-(\d{2}))?_学习日志\.md$/;

export function getLogRoot(): string {
  const root = process.env.LOG_ROOT?.trim();
  if (!root || !path.isAbsolute(root)) throw new Error("LOG_ROOT must be an explicit absolute data directory");
  return path.resolve(root);
}

export function getBackupRoot(): string {
  const root = process.env.BACKUP_ROOT?.trim();
  if (!root || !path.isAbsolute(root)) throw new Error("BACKUP_ROOT must be an explicit absolute backup directory");
  return path.resolve(root);
}

function requiredSecret(name: string, minimum: number): string {
  const value = process.env[name] || "";
  if (value.trim().length < minimum || /^(?:change-me|replace-|dev-session-secret)/i.test(value)) {
    throw new Error(`${name} is missing or insecure; initialize the instance before starting`);
  }
  return value;
}

export function getAppPassword(): string { return requiredSecret("APP_PASSWORD", 12); }
export function getSessionSecret(): string { return requiredSecret("SESSION_SECRET", 32); }

export function getCookieSecure(): boolean {
  const value = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (["true", "1", "yes"].includes(value || "")) return true;
  if (["false", "0", "no"].includes(value || "")) return false;
  return process.env.NODE_ENV === "production";
}

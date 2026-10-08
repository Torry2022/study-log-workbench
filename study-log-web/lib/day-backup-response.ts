import { LogConflictError, LogWriteInputError } from "./log-store.ts";
import { DayBackupInputError, DayBackupNotFoundError } from "./day-backup-store.ts";
import { InvalidDayContentError } from "./day-content.ts";
import { FutureLogDateError } from "./study-date.ts";

export const dayBackupHeaders = { "Cache-Control": "no-store" };
export function dayBackupErrorResponse(error: unknown): Response {
  if (error instanceof LogConflictError) return Response.json({ error: error.message, code: "LOG_CONFLICT" }, { status: 409, headers: dayBackupHeaders });
  if (error instanceof DayBackupNotFoundError) return Response.json({ error: error.message }, { status: 404, headers: dayBackupHeaders });
  if (error instanceof DayBackupInputError || error instanceof LogWriteInputError || error instanceof InvalidDayContentError || error instanceof FutureLogDateError) {
    return Response.json({ error: error.message }, { status: 400, headers: dayBackupHeaders });
  }
  return Response.json({ error: "日块备份操作失败，请检查存储状态后重试" }, { status: 500, headers: dayBackupHeaders });
}

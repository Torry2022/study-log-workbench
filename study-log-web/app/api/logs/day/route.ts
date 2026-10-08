import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getDay, saveDay, deleteDay, LogWriteInputError, LogConflictError } from "@/lib/log-store";
import { logReadResponse } from "@/lib/log-read-response";
import { InvalidDayContentError } from "@/lib/day-content";
import { FutureLogDateError } from "@/lib/study-date";
import type { SaveDayInput, DeleteDayInput } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const date = request.nextUrl.searchParams.get("date") || "";
  return logReadResponse("/api/logs/day", async () => ({ day: await getDay(date) }), 400);
}

export async function PUT(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store" };
  let body: SaveDayInput;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers }); }
  try { return Response.json({ day: await saveDay(body) }, { headers }); }
  catch (error) {
    if (error instanceof LogConflictError) return Response.json({ error: error.message, code: "LOG_CONFLICT" }, { status: 409, headers });
    if (error instanceof LogWriteInputError || error instanceof InvalidDayContentError || error instanceof FutureLogDateError) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    return Response.json({ error: "日志保存失败，未能确认日志是否已保存，请检查实例存储后重试" }, { status: 500, headers });
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store" };
  let body: DeleteDayInput;
  try { body = await request.json(); }
  catch { return Response.json({ error: "请求正文必须是有效 JSON" }, { status: 400, headers }); }
  try { return Response.json({ day: await deleteDay(body) }, { headers }); }
  catch (error) {
    if (error instanceof LogConflictError) return Response.json({ error: error.message, code: "LOG_CONFLICT" }, { status: 409, headers });
    if (error instanceof LogWriteInputError) return Response.json({ error: error.message }, { status: 400, headers });
    return Response.json({ error: "日块删除失败，请检查实例存储后重试" }, { status: 500, headers });
  }
}

import { NextResponse } from "next/server";

export async function logReadResponse(route: string, read: () => Promise<unknown>, errorStatus = 500) {
  const started = performance.now();
  let response: NextResponse;
  try { response = NextResponse.json(await read()); }
  catch (error) {
    // Do not expose filesystem paths or operating-system error details.
    const invalidInput = error instanceof Error && /^Invalid (date|month)\./.test(error.message);
    const sourceIssue = error instanceof Error && ["源文件中存在重复日期，请先整理源文件", "源文件包含无效日期", "日志日期与源文件年月不一致"].includes(error.message);
    response = NextResponse.json({ error: invalidInput || sourceIssue ? (error as Error).message : "日志读取失败，请检查日志源文件后重试" }, { status: invalidInput ? errorStatus : 500 });
  }
  const duration = Math.round(performance.now() - started);
  response.headers.set("Server-Timing", `log_read;dur=${duration}`);
  response.headers.set("Cache-Control", "no-store");
  if (duration >= 1000 || response.status >= 400) console.warn("[log-read]", { route, duration, status: response.status });
  return response;
}

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { taskAction, taskRuntime } from "@/lib/rag-task-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  const id = (await context.params).id;
  const initial = await taskAction(request, async () => ({ task: await taskRuntime().get(id) }));
  if (!initial.ok) return initial;
  const encoder = new TextEncoder(); let stopped = false;
  let after = Number(request.nextUrl.searchParams.get("after") || request.headers.get("last-event-id") || "0");
  if (!Number.isSafeInteger(after) || after < 0) return Response.json({ error: "事件位置无效" }, { status: 400 });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!stopped && !request.signal.aborted) {
          if (requireAuth(request)) { controller.enqueue(encoder.encode('event: error\ndata: {"error":"Unauthorized"}\n\n')); break; }
          const task = await taskRuntime().get(id);
          if (task.revision > after) {
            after = task.revision;
            controller.enqueue(encoder.encode(`id: ${after}\nevent: snapshot\ndata: ${JSON.stringify({ task })}\n\n`));
          }
          if (!["queued", "running"].includes(task.state) && (task.state !== "succeeded" || task.saveState !== "pending")) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      } catch { if (!stopped && !request.signal.aborted) controller.enqueue(encoder.encode('event: error\ndata: {"error":"任务读取失败，请重新连接"}\n\n')); }
      finally { if (!stopped) { stopped = true; controller.close(); } }
    },
    cancel() { stopped = true; }
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

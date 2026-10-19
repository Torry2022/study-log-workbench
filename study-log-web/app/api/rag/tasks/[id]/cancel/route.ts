import { NextRequest } from "next/server";
import { taskAction, taskRuntime } from "@/lib/rag-task-api";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { return taskAction(request, async () => ({ task: await taskRuntime().cancel((await context.params).id) })); }

import { NextRequest } from "next/server";
import { taskAction, taskRuntime } from "@/lib/rag-task-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) { return taskAction(request, async () => ({ task: await taskRuntime().get((await context.params).id) })); }
export async function DELETE(request: NextRequest, context: Context) { return taskAction(request, async () => { await taskRuntime().remove((await context.params).id); return { removed: true }; }); }

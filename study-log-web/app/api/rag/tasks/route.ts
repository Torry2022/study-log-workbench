import { NextRequest } from "next/server";
import { taskAction, taskRuntime, taskSubmission } from "@/lib/rag-task-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { return taskAction(request, async () => ({ tasks: await taskRuntime().list() })); }
export async function POST(request: NextRequest) { return taskAction(request, async () => ({ task: await taskRuntime().create(await taskSubmission(request)) })); }

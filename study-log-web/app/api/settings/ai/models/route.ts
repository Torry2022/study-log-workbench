import { NextRequest } from "next/server";
import { probeSettings } from "@/lib/ai-settings-probe";
import { settingsFailure } from "@/lib/ai-settings-operation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { try { return Response.json(await probeSettings(request, "models"), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return settingsFailure(error); } }

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { GenerationPresetError, listGenerationPresets, mutateGenerationPresets } from "@/lib/generation-presets-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  const known = error instanceof GenerationPresetError;
  return Response.json({ error: known ? error.message : "读取或保存生成方案失败，请检查生成方案文件后重试", code: known ? error.code : "GENERATION_PRESET_FAILED" }, { status: known ? error.status : 500, headers });
}
async function body(request: NextRequest): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new GenerationPresetError("请求正文必须是 JSON 对象");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 400_000) throw new GenerationPresetError("方案请求过大", 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new GenerationPresetError("请求正文必须是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GenerationPresetError("请求正文必须是 JSON 对象");
  return value as Record<string, unknown>;
}
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try { return Response.json(await listGenerationPresets(), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const input = await body(request);
    return Response.json(await mutateGenerationPresets({ action: "create", version: input.version, name: input.name, prompt: input.prompt }), { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const input = await body(request);
    if ("defaultPresetId" in input) {
      if ("id" in input || "name" in input || "prompt" in input) throw new GenerationPresetError("请分别保存方案内容和默认选择");
      return Response.json(await mutateGenerationPresets({ action: "default", version: input.version, defaultPresetId: input.defaultPresetId }), { headers });
    }
    return Response.json(await mutateGenerationPresets({ action: "update", version: input.version, id: input.id, name: input.name, prompt: input.prompt }), { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const input = await body(request);
    return Response.json(await mutateGenerationPresets({ action: "delete", version: input.version, id: input.id }), { headers });
  } catch (error) { return failure(error); }
}

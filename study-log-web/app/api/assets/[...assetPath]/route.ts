import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { readAssetResponse } from "@/lib/asset-read";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ assetPath: string[] }> }) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const { assetPath } = await context.params;
  return readAssetResponse(getLogRoot(), assetPath);
}

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { readAssetResponse } from "@/lib/asset-read";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization"
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest, context: { params: Promise<{ assetPath: string[] }> }) {
  const unauthorized = requireAuth(request);
  if (unauthorized) {
    Object.entries(corsHeaders).forEach(([name, value]) => unauthorized.headers.set(name, value));
    return unauthorized;
  }
  const { assetPath } = await context.params;
  const response = await readAssetResponse(getLogRoot(), assetPath);
  Object.entries(corsHeaders).forEach(([name, value]) => response.headers.set(name, value));
  return response;
}

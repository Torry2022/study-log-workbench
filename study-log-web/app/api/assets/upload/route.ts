import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLogRoot } from "@/lib/config";
import { AssetUploadInputError, AssetUploadTooLargeError, readUploadForm, uploadAssets } from "@/lib/asset-upload";
import { InvalidAssetPath } from "@/lib/asset-path";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const form = await readUploadForm(request);
    return Response.json({ assets: await uploadAssets(getLogRoot(), form) }, { headers });
  } catch (error) {
    if (error instanceof AssetUploadInputError) return Response.json({ error: error.message }, { status: error instanceof AssetUploadTooLargeError ? 413 : 400, headers });
    if (error instanceof InvalidAssetPath) return Response.json({ error: "附件目录不符合实例路径规则" }, { status: 400, headers });
    return Response.json({ error: "图片上传失败，请检查实例存储后重试" }, { status: 500, headers });
  }
}

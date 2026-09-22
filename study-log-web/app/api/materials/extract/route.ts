import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractDocumentFromFile, readMaterialForm, MaterialInputError, MaterialTooLargeError } from "@/lib/upload-extract";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const file = await readMaterialForm(request);
    return Response.json({ document: await extractDocumentFromFile(file) }, { headers });
  } catch (error) {
    if (error instanceof MaterialInputError) return Response.json({ error: error.message }, { status: error instanceof MaterialTooLargeError ? 413 : 400, headers });
    return Response.json({ error: "材料解析失败，请稍后重试" }, { status: 500, headers });
  }
}

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildLogExport, ExportChangedError, ExportInputError, ExportNotFoundError } from "@/lib/export-store";
import { NoteRecoveryError } from "@/lib/notes-types";

export const runtime = "nodejs";
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const output = await buildLogExport(request.nextUrl.searchParams.get("scope"), request.nextUrl.searchParams.get("date"));
    return new Response(new Uint8Array(output.buffer), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": contentDisposition(output.fileName),
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-Warning-Count": String(output.warnings.length)
    } });
  } catch (error) {
    const status = error instanceof ExportInputError ? 400 : error instanceof ExportNotFoundError ? 404 : error instanceof ExportChangedError ? 409 : error instanceof NoteRecoveryError ? 503 : 500;
    const message = status === 500 ? "导出失败，请检查实例源文件和附件后重试" : (error as Error).message;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

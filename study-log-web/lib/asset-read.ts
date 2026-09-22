import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { checkAssetPath as checkPath, InvalidAssetPath, validAssetSegments as validSegments } from "./asset-path.ts";

const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".bmp": "image/bmp"
};

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
  } });
}

/** Auth must be checked by the route before this filesystem boundary is entered. */
export async function readAssetResponse(dataRoot: string, segments: string[]): Promise<Response> {
  if (!path.isAbsolute(dataRoot) || !validSegments(segments)) return errorResponse(400, "Invalid asset path");
  const assetsRoot = path.resolve(dataRoot, "assets");
  const filePath = path.resolve(assetsRoot, ...segments);
  const relative = path.relative(assetsRoot, filePath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return errorResponse(400, "Invalid asset path");
  }
  try {
    await checkPath(filePath);
    const stat = await fs.lstat(filePath, { bigint: true });
    if (!stat.isFile()) return errorResponse(404, "Asset not found");
    const file = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      // Recheck after opening so a link substituted during the first check is refused.
      await checkPath(filePath);
      const opened = await file.stat({ bigint: true });
      // Windows path lstat may report dev=0 while fstat reports a volume id.
      if (!opened.isFile() || opened.ino !== stat.ino ||
        (process.platform !== "win32" && opened.dev !== stat.dev)) throw new InvalidAssetPath();
      const body = new Uint8Array(await file.readFile());
      return new Response(body, { headers: {
        "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": String(body.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, no-store"
      } });
    } finally { await file.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (error instanceof InvalidAssetPath || code === "ELOOP") return errorResponse(400, "Invalid asset path");
    if (code === "ENOENT" || code === "ENOTDIR") return errorResponse(404, "Asset not found");
    return errorResponse(500, "Asset could not be read");
  }
}

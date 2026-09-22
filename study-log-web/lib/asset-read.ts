import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const contentTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".bmp": "image/bmp"
};

class InvalidAssetPath extends Error {}

function validSegments(segments: string[]): boolean {
  return segments.length > 0 && segments.every(segment => typeof segment === "string" &&
    segment.length > 0 && segment !== "." && segment !== ".." &&
    !/[\\/:\u0000-\u001f\u007f]/.test(segment) && !/[. ]$/.test(segment));
}

// Check the data root and assets root themselves, not only a realpath-relative child:
// accepting a symlinked assets root would authorize another instance's entire directory.
async function checkPath(file: string): Promise<void> {
  let current = path.parse(file).root;
  const parts = file.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new InvalidAssetPath();
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw Object.assign(new Error(), { code: "ENOTDIR" });
    }
  }
}

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

import fs from "node:fs/promises";
import path from "node:path";

export class InvalidAssetPath extends Error {}

export function validAssetSegments(segments: string[]): boolean {
  return segments.length > 0 && segments.every(segment => typeof segment === "string" &&
    segment.length > 0 && segment !== "." && segment !== ".." &&
    !/[\\/:\u0000-\u001f\u007f]/.test(segment) && !/[. ]$/.test(segment));
}

// Include the instance and assets roots themselves in the link boundary.
export async function checkAssetPath(file: string): Promise<void> {
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

/** Shared browser/server metadata rules; uploaded bytes are not re-encoded. */
export const MAX_IMAGE_COUNT = 10;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
  "image/gif": ".gif", "image/bmp": ".bmp", "image/svg+xml": ".svg"
};
export const IMAGE_ACCEPT = Object.keys(IMAGE_MIME_EXTENSIONS).join(",");

export function imageExtension(file: { name: string; type: string }): string {
  const fallback = IMAGE_MIME_EXTENSIONS[file.type];
  if (!fallback) return "";
  const extension = /\.[^.\\/]+$/.exec(file.name)?.[0].toLowerCase() || "";
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"].includes(extension) ? extension : fallback;
}

export interface UploadedAsset { fileName: string; path: string; markdown: string }

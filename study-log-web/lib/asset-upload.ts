import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkAssetPath, InvalidAssetPath } from "./asset-path.ts";
import { imageExtension, MAX_IMAGE_BYTES, MAX_IMAGE_COUNT } from "./asset-upload-rules.ts";
import type { UploadedAsset } from "./asset-upload-rules.ts";

export class AssetUploadInputError extends Error {}
export class AssetUploadTooLargeError extends AssetUploadInputError {}
export const MAX_UPLOAD_BODY_BYTES = MAX_IMAGE_BYTES * MAX_IMAGE_COUNT + 1024 * 1024;

/** Bound the actual stream as well as Content-Length before multipart parsing. */
export async function readUploadForm(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new AssetUploadInputError("上传请求必须使用 multipart/form-data");
  }
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BODY_BYTES) {
    throw new AssetUploadTooLargeError("上传请求超过大小限制");
  }
  if (!request.body) throw new AssetUploadInputError("请选择图片");
  let size = 0;
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > MAX_UPLOAD_BODY_BYTES) throw new AssetUploadTooLargeError("上传请求超过大小限制");
      controller.enqueue(chunk);
    }
  }));
  try { return await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData(); }
  catch (error) {
    if (error instanceof AssetUploadTooLargeError) throw error;
    throw new AssetUploadInputError("无法解析图片上传请求");
  }
}

/** Validate the entire batch before creating directories or writing any bytes. */
export async function uploadAssets(dataRoot: string, form: FormData): Promise<UploadedAsset[]> {
  const scope = form.get("scope");
  if (scope !== null && scope !== "logs") throw new AssetUploadInputError("暂不支持此附件分类");
  const entries = form.getAll("file");
  if (!entries.length || entries.length > MAX_IMAGE_COUNT) throw new AssetUploadInputError(`每次请选择 1 至 ${MAX_IMAGE_COUNT} 张图片`);
  const files: { file: File; extension: string }[] = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) throw new AssetUploadInputError("file 必须是图片文件");
    const extension = imageExtension(entry);
    if (!extension) throw new AssetUploadInputError("仅支持 PNG、JPEG、WebP、GIF、BMP 和 SVG 图片");
    if (!entry.size) throw new AssetUploadInputError("不能上传空图片");
    if (entry.size > MAX_IMAGE_BYTES) throw new AssetUploadTooLargeError("每张图片不得超过 20 MiB");
    files.push({ file: entry, extension });
  }
  if (!path.isAbsolute(dataRoot)) throw new InvalidAssetPath();
  await checkAssetPath(dataRoot);
  if (!(await fs.lstat(dataRoot)).isDirectory()) throw new InvalidAssetPath();
  const directory = path.join(dataRoot, "assets");
  try { await fs.mkdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await checkAssetPath(directory);
  if (!(await fs.lstat(directory)).isDirectory()) throw new InvalidAssetPath();
  const created: { filePath: string; ino: bigint }[] = [];
  const assets: UploadedAsset[] = [];
  try {
    for (const { file, extension } of files) {
      const fileName = `image-${Date.now()}-${randomUUID()}${extension}`;
      const filePath = path.join(directory, fileName);
      await checkAssetPath(directory);
      const handle = await fs.open(filePath, "wx");
      try {
        const opened = await handle.stat({ bigint: true });
        created.push({ filePath, ino: opened.ino });
        await checkAssetPath(filePath);
        if ((await fs.lstat(filePath, { bigint: true })).ino !== opened.ino) throw new InvalidAssetPath();
        await handle.writeFile(new Uint8Array(await file.arrayBuffer()));
        await handle.sync();
      } finally { await handle.close(); }
      const markdownPath = `./assets/${fileName}`;
      assets.push({ fileName, path: markdownPath, markdown: `![${fileName.slice(0, -extension.length)}](${markdownPath})` });
    }
    return assets;
  } catch (error) {
    // Remove only files created by this batch, never follow a substituted directory.
    for (const { filePath, ino } of created) {
      try {
        await checkAssetPath(filePath);
        if ((await fs.lstat(filePath, { bigint: true })).ino === ino) await fs.unlink(filePath);
      } catch { /* Preserve an uncertain path instead of deleting another file. */ }
    }
    throw error;
  }
}

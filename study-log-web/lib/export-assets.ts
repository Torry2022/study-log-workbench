import { unified } from "unified";
import remarkParse from "remark-parse";
import { validAssetSegments } from "./asset-path.ts";

export class ExportInputError extends Error {}
export interface ExportAssetReference { asset: string; start: number; end: number; replacement: string | null }
const parser = unified().use(remarkParse);

function localAsset(raw: string): { asset: string; suffix: string; needsRelative: boolean } | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) return null;
  const suffix = raw.match(/[?#].*$/)?.[0] || "";
  let value: string;
  try { value = decodeURIComponent(suffix ? raw.slice(0, -suffix.length) : raw).replace(/\\/g, "/"); }
  catch { throw new ExportInputError("附件地址编码无效，未生成导出文件"); }
  const api = value.match(/^\/(?:study-log\/)?api\/assets\/(.+)$/);
  const relative = value.match(/^(?:\.\/|\.\.\/|\/)?assets\/(.+)$/);
  if (!api && !relative) {
    if (/(?:^|\/)assets(?:\/|$)/.test(value)) throw new ExportInputError("附件地址超出支持的 assets 目录范围");
    return null;
  }
  const asset = (api || relative)![1];
  if (!validAssetSegments(asset.split("/"))) throw new ExportInputError("附件地址包含不安全的路径片段");
  return { asset, suffix, needsRelative: Boolean(api) || value.startsWith("/") };
}

interface MarkdownNode {
  type: string; url?: string; identifier?: string; children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

function destinationRange(raw: string, from: number): [number, number] {
  let start = from;
  while (/\s/.test(raw[start] || "") && start < raw.length) start++;
  if (raw[start] === "<") {
    const end = raw.indexOf(">", start + 1);
    if (end < 0) throw new ExportInputError("本地图片地址语法无效");
    return [start + 1, end];
  }
  let end = start, depth = 0;
  while (end < raw.length) {
    const char = raw[end];
    if (char === "\\") { end += 2; continue; }
    if (char === "(") depth++;
    if (char === ")") { if (!depth) break; depth--; }
    if (/\s/.test(char) && !depth) break;
    end++;
  }
  return [start, end];
}

/** Use the Markdown tree so code examples do not cause filesystem reads. */
export function exportAssetReferences(markdown: string, notes: boolean): ExportAssetReference[] {
  const nodes: MarkdownNode[] = [];
  function visit(node: MarkdownNode) { nodes.push(node); node.children?.forEach(visit); }
  visit(parser.parse(markdown) as MarkdownNode);
  const imageIds = new Set(nodes.filter(node => node.type === "imageReference").map(node => node.identifier?.toLowerCase()));
  const seenDefinitions = new Set<string>();
  const refs: ExportAssetReference[] = [];
  function add(url: string, start: number, end: number) {
    const local = localAsset(url); if (!local) return;
    const prefix = notes ? "../assets/" : "./assets/";
    // Keep already-working product-relative URLs byte-for-byte. API URLs need
    // an offline relative form in the exported Markdown.
    const correctRelative = url.startsWith(prefix) || (!notes && url.startsWith("assets/"));
    const replacement = local.needsRelative || !correctRelative
      ? prefix + local.asset.split("/").map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/") + local.suffix : null;
    refs.push({ asset: local.asset, start, end, replacement });
  }
  for (const node of nodes) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const raw = markdown.slice(start, end);
    if (node.type === "image" && node.url) {
      if (!localAsset(node.url)) continue;
      const marker = raw.indexOf("](");
      if (marker < 0) throw new ExportInputError("本地图片地址语法无效");
      const [a, b] = destinationRange(raw, marker + 2);
      add(node.url, start + a, start + b);
    } else if (node.type === "definition" && node.url && node.identifier && imageIds.has(node.identifier.toLowerCase()) && !seenDefinitions.has(node.identifier.toLowerCase())) {
      seenDefinitions.add(node.identifier.toLowerCase());
      const marker = raw.indexOf("]:");
      if (marker < 0) continue;
      const [a, b] = destinationRange(raw, marker + 2);
      add(node.url, start + a, start + b);
    } else if (node.type === "html") {
      for (const image of raw.matchAll(/<img\b[^>]*>/gi)) {
        const source = image[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
        if (!source || source.index === undefined || image.index === undefined) continue;
        const a = start + image.index + source.index + source[0].indexOf(source[1]) + 1;
        add(source[2], a, a + source[2].length);
      }
    }
  }
  return refs;
}

export function rewriteExportAssetLinks(markdown: string, references: ExportAssetReference[]): string {
  let result = markdown;
  for (const ref of [...references].sort((a, b) => b.start - a.start)) {
    if (ref.replacement !== null) result = result.slice(0, ref.start) + ref.replacement + result.slice(ref.end);
  }
  return result;
}

import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";

export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 500_000;
export const MAX_MATERIAL_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2048;
export const MAX_ARCHIVE_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_PDF_PAGES = 500;
export class MaterialInputError extends Error {}
export class MaterialTooLargeError extends MaterialInputError {}

export async function readMaterialForm(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new MaterialInputError("材料请求必须使用 multipart/form-data");
  if (Number(request.headers.get("content-length")) > MAX_MATERIAL_BODY_BYTES) throw new MaterialTooLargeError("材料请求超过大小限制");
  if (!request.body) throw new MaterialInputError("请选择材料文件");
  let bytes = 0;
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_MATERIAL_BODY_BYTES) throw new MaterialTooLargeError("材料请求超过大小限制");
      controller.enqueue(chunk);
    }
  }));
  let form: FormData;
  try { form = await new Response(body, { headers: { "content-type": contentType } }).formData(); }
  catch (error) {
    if (error instanceof MaterialTooLargeError) throw error;
    throw new MaterialInputError("无法解析材料上传请求");
  }
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) throw new MaterialInputError("每次请选择一个材料文件");
  return files[0];
}

export interface ExtractedDocumentSection {
  id: string;
  locator: string;
  text: string;
}

export interface ExtractedDocument {
  fileName: string;
  fileType: "text" | "markdown" | "pdf" | "docx" | "pptx";
  size: number;
  text: string;
  sections: ExtractedDocumentSection[];
  warnings: string[];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeSectionText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function makeSections(
  chunks: Array<{ locator: string; text: string }>
): ExtractedDocumentSection[] {
  return chunks
    .map((chunk) => ({ locator: chunk.locator.trim(), text: normalizeSectionText(chunk.text) }))
    .filter((chunk) => chunk.text)
    .map((chunk, index) => ({ id: `S${index + 1}`, ...chunk }));
}

function paragraphSections(text: string): ExtractedDocumentSection[] {
  const paragraphs = normalizeWhitespace(text).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: Array<{ locator: string; text: string }> = [];
  let current: string[] = [];
  let start = 1;

  const flush = () => {
    if (current.length === 0) return;
    const end = start + current.length - 1;
    chunks.push({
      locator: start === end ? `段落 ${start}` : `段落 ${start}-${end}`,
      text: current.join("\n\n")
    });
    start = end + 1;
    current = [];
  };

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.join("\n\n").length + paragraph.length > 6_000) flush();
    current.push(paragraph);
  }
  flush();
  return makeSections(chunks);
}

function markdownSections(text: string): ExtractedDocumentSection[] {
  const normalized = normalizeMarkdownText(text);
  const chunks: Array<{ locator: string; text: string }> = [];
  let locator = "正文";
  let start = 0;
  for (const node of unified().use(remarkParse).parse(normalized).children) {
    if (node.type !== "heading" || node.position?.start.offset === undefined) continue;
    const offset = node.position.start.offset;
    const text = normalized.slice(start, offset).trim();
    if (text) chunks.push({ locator, text });
    locator = normalized.slice(offset, node.position.end.offset).split("\n")[0].replace(/^ {0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
    start = offset;
  }
  chunks.push({ locator, text: normalized.slice(start) });
  return makeSections(chunks.length > 0 ? chunks : [{ locator: "正文", text: normalized }]);
}

function assertExtractedText(text: string): string {
  const normalized = text.trim();
  if (!normalized) throw new MaterialInputError("文件中未提取到可用文本");
  if (normalized.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new MaterialTooLargeError(`文件提取文本超过 ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString("zh-CN")} 字符，请拆分后重新导入`);
  }
  return normalized;
}

function normalizeMarkdownText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Verify actual inflation, not just untrusted ZIP size metadata, before Office parsers run. */
async function inspectOfficeArchive(buffer: Buffer): Promise<Map<string, Buffer>> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new MaterialTooLargeError("Office 文件包含过多压缩条目");
  const selected = new Map<string, Buffer>();
  const names = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (names.has(name) || name.includes("\\") || name.startsWith("/") || name.split("/").some(part => part === "..") || /vbaProject\.bin$/i.test(name)) throw new MaterialInputError("Office 文件包含不支持的路径、重复条目或宏");
    names.add(name);
    if (entry.header.flags & 1 || ![0, 8].includes(entry.header.method)) throw new MaterialInputError("不支持加密或特殊压缩的 Office 文件");
    if (entry.header.size > MAX_ARCHIVE_ENTRY_BYTES || total + entry.header.size > MAX_ARCHIVE_TOTAL_BYTES) throw new MaterialTooLargeError("Office 文件解压内容超过限制");
    const compressed = entry.getCompressedData();
    let data: Buffer;
    try { data = entry.header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_ARCHIVE_ENTRY_BYTES, MAX_ARCHIVE_TOTAL_BYTES - total) + 1 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new MaterialTooLargeError("Office 文件解压内容超过限制");
      throw error;
    }
    total += data.length;
    if (data.length > MAX_ARCHIVE_ENTRY_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES) throw new MaterialTooLargeError("Office 文件解压内容超过限制");
    if (data.length !== entry.header.size) throw new MaterialInputError("Office 文件的压缩长度不一致");
    if (/\.(?:xml|rels)$/i.test(name) && /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(data.toString("utf8"))) throw new MaterialInputError("不支持含自定义 XML 实体的 Office 文件");
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name) || name === "word/document.xml") selected.set(name, data);
  }
  return selected;
}

function extractPptx(entries: Map<string, Buffer>): { text: string; sections: ExtractedDocumentSection[] } {
  const slides = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const chunks = slides.map((slide, index) => {
    const xml = entries.get(slide)!.toString("utf8");
    const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1]).trim())
      .filter(Boolean)
      .join(" ");
    return { locator: `Slide ${index + 1}`, text };
  });
  const sections = makeSections(chunks);
  return {
    text: normalizeWhitespace(sections.map((section) => `${section.locator}\n${section.text}`).join("\n\n")),
    sections
  };
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

interface PdfLine {
  y: number;
  x: number;
  text: string;
}

function compactPdfLine(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?，。；：！？、])/g, "$1")
    .trim();
}

function linesToParagraphs(lines: string[]): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(paragraph.join(" "));
    paragraph = [];
  }

  for (const rawLine of lines) {
    const line = compactPdfLine(rawLine);
    if (!line) {
      flushParagraph();
      continue;
    }

    const isListLike = /^(\d+[.)]|[-*•])\s+/.test(line);
    const endsSentence = /[。.!?！？；;：:]$/.test(line);
    const isShortHeading = line.length <= 36 && !endsSentence && !isListLike;

    if (isListLike) {
      flushParagraph();
      blocks.push(line.replace(/^•\s+/, "- "));
      continue;
    }

    if (isShortHeading && paragraph.length === 0) {
      blocks.push(`**${line}**`);
      continue;
    }

    paragraph.push(line);
    if (endsSentence) flushParagraph();
  }

  flushParagraph();
  return blocks.join("\n\n");
}

async function renderPdfPage(pageData: { getTextContent: () => Promise<{ items: unknown[] }> }) {
  const textContent = await pageData.getTextContent();

  const items = textContent.items
    .filter((item): item is PdfTextItem => Boolean(item && typeof item === "object" && "str" in item))
    .map((item) => ({
      text: item.str || "",
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
      height: item.height || Math.abs(item.transform?.[3] || 0) || 10
    }))
    .filter((item) => item.text.trim());

  const lines: Array<{ y: number; x: number; items: typeof items }> = [];
  for (const item of items) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= Math.max(2, item.height * 0.35));
    if (existing) {
      existing.items.push(item);
      existing.x = Math.min(existing.x, item.x);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({ y: item.y, x: item.x, items: [item] });
    }
  }

  const sortedLines: PdfLine[] = lines
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((line) => ({
      y: line.y,
      x: line.x,
      text: line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
    }));

  const lineTexts: string[] = [];
  for (let index = 0; index < sortedLines.length; index += 1) {
    const current = sortedLines[index];
    const previous = sortedLines[index - 1];
    if (previous && Math.abs(previous.y - current.y) > 22) {
      lineTexts.push("");
    }
    lineTexts.push(current.text);
  }

  return linesToParagraphs(lineTexts);
}

async function extractPdfMarkdown(
  buffer: Buffer,
  fileName: string
): Promise<{ text: string; sections: ExtractedDocumentSection[]; warnings: string[] }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Resolve at runtime: webpack turns a statically recognized require.resolve into a numeric module id.
  const runtimeRequire = process.getBuiltinModule("node:module").createRequire(path.join(process.cwd(), "package.json"));
  const pdfRoot = path.dirname(runtimeRequire.resolve("pdfjs-dist/package.json"));
  const pageChunks: Array<{ locator: string; text: string }> = [];
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, useWasm: false, stopAtErrors: true,
    standardFontDataUrl: path.join(pdfRoot, "standard_fonts") + "/", cMapUrl: path.join(pdfRoot, "cmaps") + "/", cMapPacked: true });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) throw new MaterialTooLargeError(`PDF 超过 ${MAX_PDF_PAGES} 页，请拆分后导入`);
    const chunks: string[] = [];
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      let pageText: string;
      try { pageText = await renderPdfPage(page); } finally { page.cleanup(); }
      chars += pageText.length;
      if (chars > MAX_EXTRACTED_TEXT_CHARS) throw new MaterialTooLargeError("PDF 提取文本超过 500,000 字符，请拆分后导入");
      if (pageText) pageChunks.push({ locator: `Page ${pageNumber}`, text: pageText });
      chunks.push(pageText ? `### Page ${pageNumber}\n\n${pageText}` : `### Page ${pageNumber}\n\n[本页未提取到可复制文本]`);
    }
    const warnings = ["PDF仅提取文本层；扫描图片、复杂公式和图片内容不会自动识别"];
    if (pageChunks.length < document.numPages) warnings.push(`${document.numPages - pageChunks.length} 页未提取到可复制文本`);
    return { text: normalizeMarkdownText([`## PDF: ${fileName}`, `- 页数：${document.numPages}`, chunks.join("\n\n")].join("\n\n")), sections: makeSections(pageChunks), warnings };
  } finally { await task.destroy(); }
}

export async function extractDocumentFromFile(file: File): Promise<ExtractedDocument> {
  const name = file.name.toLowerCase();
  if (!file.name.trim() || /[\u0000-\u001f\u007f]/.test(file.name)) throw new MaterialInputError("文件名无效");
  if (!/\.(?:txt|md|markdown|pdf|docx|pptx)$/.test(name)) throw new MaterialInputError("不支持该文件类型，可导入 txt、md、pdf、docx 或 pptx");
  if (file.size <= 0) throw new MaterialInputError("不能导入空文件");
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new MaterialTooLargeError("材料文件超过 20 MiB，请压缩或拆分后重新导入");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const decodeText = () => {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
      catch { throw new MaterialInputError("文本文件必须使用 UTF-8 编码"); }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new MaterialInputError("文本文件包含二进制控制字符");
      return text;
    };

    if (name.endsWith(".txt")) {
      const text = assertExtractedText(normalizeWhitespace(decodeText()));
      return { fileName: file.name, fileType: "text", size: file.size, text, sections: paragraphSections(text), warnings: [] };
    }

    if (name.endsWith(".md") || name.endsWith(".markdown")) {
      const text = assertExtractedText(normalizeMarkdownText(decodeText()));
      return { fileName: file.name, fileType: "markdown", size: file.size, text, sections: markdownSections(text), warnings: [] };
    }

    if (name.endsWith(".pdf")) {
      if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new MaterialInputError("文件不是有效 PDF");
      const extracted = await extractPdfMarkdown(buffer, file.name);
      if (extracted.sections.length === 0) throw new MaterialInputError("未提取到可复制文本，扫描版 PDF 暂不支持 OCR");
      const text = assertExtractedText(extracted.text);
      return { fileName: file.name, fileType: "pdf", size: file.size, text, sections: extracted.sections, warnings: extracted.warnings };
    }

    if (name.endsWith(".docx")) {
      const entries = await inspectOfficeArchive(buffer);
      if (!entries.has("word/document.xml")) throw new MaterialInputError("文件不包含有效 Word 正文");
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = assertExtractedText(normalizeWhitespace(result.value || ""));
      const warnings = ["Word仅提取正文文本，不保留图片和完整版式", ...(result.messages.length > 0 ? ["Word文档存在未完整转换的内容"] : [])];
      return { fileName: file.name, fileType: "docx", size: file.size, text, sections: paragraphSections(text), warnings };
    }

    if (name.endsWith(".pptx")) {
      const extracted = extractPptx(await inspectOfficeArchive(buffer));
      const text = assertExtractedText(extracted.text);
      return {
        fileName: file.name,
        fileType: "pptx",
        size: file.size,
        text,
        sections: extracted.sections,
        warnings: ["PPTX仅提取幻灯片文本，不包含演讲者备注、图片和版式关系"]
      };
    }

    throw new MaterialInputError("不支持该文件类型，可导入 txt、md、pdf、docx 或 pptx");
  } catch (error) {
    if (error instanceof MaterialInputError) throw error;
    throw new MaterialInputError("材料文件损坏、受密码保护或包含无法解析的内容");
  }
}

export async function extractTextFromFile(file: File): Promise<string> {
  return (await extractDocumentFromFile(file)).text;
}

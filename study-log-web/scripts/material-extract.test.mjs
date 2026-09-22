import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { archive, slide, docx, pdf } from "../../ops/material-fixtures.mjs";
import * as material from "../lib/upload-extract.ts";

const file = (name, content, type = "application/octet-stream") => new File([content], name, { type });
const extract = (name, content) => material.extractDocumentFromFile(file(name, content));

test("UTF-8 text and Markdown preserve content and true source locators, excluding fenced pseudo-headings", async () => {
  const text = await extract("synthetic.TXT", "\uFEFFAlpha\r\n\r\nBeta");
  assert.equal(text.fileType, "text"); assert.equal(text.text, "Alpha\n\nBeta");
  assert.deepEqual(text.sections, [{ id: "S1", locator: "段落 1-2", text: "Alpha\n\nBeta" }]);
  const md = await extract("synthetic.markdown", "Intro\n\n# Real\n```md\n## Fake\n```\n\n## Next\nbody");
  assert.deepEqual(md.sections.map(section => section.locator), ["正文", "Real", "Next"]);
  assert.ok(md.sections[1].text.includes("## Fake"));
  assert.equal(md.sections.map(section => section.text).join("\n\n"), "Intro\n\n# Real\n```md\n## Fake\n```\n\n## Next\nbody");
});

test("real DOCX/PPTX parsers preserve source text, natural slide ordering, and limitations", async () => {
  const word = await extract("synthetic.docx", docx("Synthetic &amp; document"));
  assert.equal(word.fileType, "docx"); assert.equal(word.text, "Synthetic & document");
  assert.equal(word.sections[0].locator, "段落 1"); assert.ok(word.warnings.some(text => text.includes("图片")));
  const deck = await extract("synthetic.pptx", archive([["ppt/slides/slide10.xml", slide("Tenth")], ["ppt/slides/slide2.xml", slide("Second &#x4E2D; &amp; text")], ["ppt/notesSlides/notesSlide1.xml", slide("Excluded notes")]]));
  assert.deepEqual(deck.sections.map(section => section.text), ["Second 中 & text", "Tenth"]);
  assert.deepEqual(deck.sections.map(section => section.locator), ["Slide 1", "Slide 2"]);
  assert.ok(!deck.text.includes("Excluded notes")); assert.ok(deck.warnings[0].includes("演讲者备注"));
});

test("real PDF text pages keep Page locators, blank-page warnings and no-OCR behavior", async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("unexpected network request"); };
  try {
    const document = await extract("synthetic.pdf", pdf(["Synthetic first page.", "", "Synthetic third page."]));
    assert.deepEqual(document.sections.map(section => section.locator), ["Page 1", "Page 3"]);
    assert.ok(document.sections[0].text.includes("Synthetic first page."));
    assert.ok(document.warnings.some(text => text.includes("1 页")));
    await assert.rejects(extract("scanned.pdf", pdf([""])), /OCR/);
    await assert.rejects(extract("pages.pdf", pdf(Array.from({ length: material.MAX_PDF_PAGES + 1 }, () => ""))), material.MaterialTooLargeError);
  } finally { globalThis.fetch = savedFetch; }
});

test("unsupported types, binary text, invalid UTF-8, empty/damaged documents and size limits fail safely", async () => {
  for (const name of ["sample.exe", "sample.svg", "sample.html", "sample.docm", "sample.zip"]) await assert.rejects(extract(name, "synthetic"), material.MaterialInputError);
  for (const [name, bytes] of [["empty.txt", ""], ["bad.txt", Buffer.from([0xc3, 0x28])], ["binary.txt", Buffer.from([65, 0, 66])], ["bad.pdf", "not a PDF"], ["bad.docx", "not a ZIP"], ["bad.pptx", "not a ZIP"], ["blank.md", " \n "]]) await assert.rejects(extract(name, bytes), material.MaterialInputError);
  await assert.rejects(extract("large.txt", Buffer.alloc(material.MAX_UPLOAD_FILE_BYTES + 1)), material.MaterialTooLargeError);
  assert.equal((await extract("limit.txt", "a".repeat(material.MAX_EXTRACTED_TEXT_CHARS))).text.length, material.MAX_EXTRACTED_TEXT_CHARS);
  await assert.rejects(extract("large.txt", "a".repeat(material.MAX_EXTRACTED_TEXT_CHARS + 1)), material.MaterialTooLargeError);
});

test("Office archive resource checks reject excessive entry count, per-entry and cumulative inflation", async () => {
  const many = Array.from({ length: material.MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => [`f${index}.txt`, ""]);
  await assert.rejects(extract("many.pptx", archive(many)), material.MaterialTooLargeError);
  const large = Buffer.alloc(material.MAX_ARCHIVE_ENTRY_BYTES + 1, 65);
  await assert.rejects(extract("entry.pptx", archive([["ppt/slides/slide1.xml", large]])), material.MaterialTooLargeError);
  const chunk = Buffer.alloc(material.MAX_ARCHIVE_ENTRY_BYTES, 65);
  await assert.rejects(extract("total.pptx", archive(Array.from({ length: 5 }, (_, index) => [`entry${index}`, chunk]))), material.MaterialTooLargeError);
  // Lie about size in the central directory: actual inflate must remain bounded.
  const forged = archive([["ppt/slides/slide1.xml", large]]);
  const central = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0); forged.writeUInt32LE(1, central + 24);
  await assert.rejects(extract("forged.pptx", forged), material.MaterialTooLargeError);
});

test("Office XML entities, macros, encrypted archives and missing document structure are rejected", async () => {
  await assert.rejects(extract("entity.pptx", archive([["ppt/slides/slide1.xml", '<!DOCTYPE p [<!ENTITY attack SYSTEM "file:///never-read">]>' + slide("&attack;")]])), /XML/);
  await assert.rejects(extract("macro.docx", archive([["word/vbaProject.bin", "synthetic"]])), /宏/);
  await assert.rejects(extract("missing.docx", archive([["other.txt", "synthetic"]])), /Word/);
  const encrypted = archive([["ppt/slides/slide1.xml", slide("Text")]]);
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  await assert.rejects(extract("encrypted.pptx", encrypted), /加密/);
});

test("multipart enforces a single file and bounds real stream size without trusting Content-Length", async () => {
  const form = new FormData(); form.append("file", file("synthetic.txt", "text"));
  assert.equal((await material.readMaterialForm(new Request("http://localhost", { method: "POST", body: form }))).name, "synthetic.txt");
  form.append("file", file("second.txt", "second"));
  await assert.rejects(material.readMaterialForm(new Request("http://localhost", { method: "POST", body: form })), /一个/);
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } });
  await assert.rejects(material.readMaterialForm(new Request("http://localhost", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=x" } })), material.MaterialTooLargeError);
  assert.equal(canceled, true);
});

test("API authenticates before reading input, returns only document, and hides unexpected errors", async () => {
  const source = await fs.readFile(new URL("../app/api/materials/extract/route.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} }; let authorized = false; const service = { ...material };
  runInNewContext(outputText, { Response, exports: module.exports, require(name) {
    if (name === "@/lib/auth") return { requireAuth: () => authorized ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (name === "@/lib/upload-extract") return service;
    throw new Error(`Unexpected dependency ${name}`);
  } });
  assert.equal((await module.exports.POST({ get headers() { assert.fail("anonymous body access"); } })).status, 401);
  authorized = true;
  const send = uploaded => { const form = new FormData(); form.append("file", uploaded); return module.exports.POST(new Request("http://localhost", { method: "POST", body: form })); };
  const response = await send(file("synthetic.md", "# Material\nSynthetic text"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json(); assert.deepEqual(Object.keys(payload), ["document"]); assert.equal(payload.document.sections[0].locator, "Material");
  assert.equal((await send(file("bad.exe", "synthetic"))).status, 400);
  assert.equal((await send(file("large.txt", "x".repeat(material.MAX_EXTRACTED_TEXT_CHARS + 1)))).status, 413);
  service.extractDocumentFromFile = async () => { throw new Error("synthetic secret path /never/expose"); };
  const failed = await send(file("text.txt", "synthetic")); assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes("/never/expose"));
});

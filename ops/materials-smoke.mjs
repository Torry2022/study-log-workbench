import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { archive, slide, docx, pdf } from "./material-fixtures.mjs";

const [root, base = "http://127.0.0.1:3566/study-log"] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname)) throw new Error("Explicit synthetic instance and loopback URL required");
const environment = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
const identity = JSON.parse(await fs.readFile(path.join(root, "data", ".instance.json"), "utf8"));
const secrets = [environment.APP_PASSWORD, environment.SESSION_SECRET, environment.CHAT_API_KEY].filter(Boolean);
const checkNoSecrets = value => {
  for (const secret of secrets) assert.ok(!value.includes(secret), "HTTP response exposed a credential");
  assert.ok(!value.includes(root), "HTTP response exposed instance path");
};
const endpoint = `${base}/api/materials/extract`;
assert.equal((await fetch(`${base}/api/capabilities`)).status, 401);
assert.equal((await fetch(endpoint, { method: "POST", body: "unauthorized malformed input" })).status, 401);
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: environment.APP_PASSWORD }) });
assert.equal(login.status, 200, "synthetic instance login failed");
const cookie = login.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
assert.ok(cookie);
const capabilities = await fetch(`${base}/api/capabilities`, { headers: { cookie } });
assert.equal(capabilities.status, 200); assert.equal(capabilities.headers.get("cache-control"), "no-store");
const capabilityText = await capabilities.text(); checkNoSecrets(capabilityText);
const caps = JSON.parse(capabilityText);
assert.equal(caps.instanceId, identity.id); assert.equal(caps.apiContractVersion, 1);
assert.equal(typeof caps.aiConfiguration.provider.configured, "boolean");
assert.ok(Array.isArray(caps.aiConfiguration.provider.issues));
for (const kind of ["generation", "highlighting", "extraction"]) {
  const template = caps.aiConfiguration.templates[kind];
  assert.equal(typeof template.configured, "boolean");
  if (!template.configured) { assert.equal(typeof template.issue.reason, "string"); assert.equal(typeof template.issue.message, "string"); }
}
const fixtures = [
  ["synthetic.txt", "Synthetic text\n\nSecond paragraph", "text", "段落 1-2"],
  ["synthetic.md", "# Synthetic heading\n\nMaterial body\n```md\n## Not a heading\n```", "markdown", "Synthetic heading"],
  ["synthetic.pdf", pdf(["Synthetic PDF content.", ""]), "pdf", "Page 1"],
  ["synthetic.docx", docx("Synthetic Word content"), "docx", "段落 1"],
  ["synthetic.pptx", archive([["ppt/slides/slide1.xml", slide("Synthetic slide content")]]), "pptx", "Slide 1"]
];
async function send(name, bytes) {
  const form = new FormData(); form.append("file", new File([bytes], name));
  return fetch(endpoint, { method: "POST", headers: { cookie }, body: form });
}
for (const [name, bytes, type, locator] of fixtures) {
  const response = await send(name, bytes);
  const text = await response.text(); checkNoSecrets(text);
  assert.equal(response.status, 200, `${name} HTTP ${response.status}: ${text}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const payload = JSON.parse(text);
  assert.deepEqual(Object.keys(payload), ["document"]);
  assert.equal(payload.document.fileName, name); assert.equal(payload.document.fileType, type);
  assert.equal(payload.document.sections[0].locator, locator);
  assert.match(payload.document.text, /Synthetic/); assert.ok(Array.isArray(payload.document.warnings));
  if (type === "pdf") assert.ok(payload.document.warnings.some(value => value.includes("1 页")));
  console.log(`PASS production HTTP ${type}`);
}
for (const [name, bytes, status, pattern] of [
  ["unsafe.svg", "<svg></svg>", 400, /不支持/],
  ["broken.docx", "broken zip", 400, /损坏/],
  ["scanned.pdf", pdf([""]), 400, /OCR/],
  ["large.txt", "a".repeat(500_001), 413, /500,000/]
]) {
  const response = await send(name, bytes); const text = await response.text(); checkNoSecrets(text);
  assert.equal(response.status, status, name); assert.match(JSON.parse(text).error, pattern);
}
console.log("PASS anonymous 401, instance capabilities/local diagnostics, five formats, damaged/unsupported/no-OCR/limits; no model calls or log writes");

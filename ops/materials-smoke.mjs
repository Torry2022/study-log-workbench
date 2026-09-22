import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { archive, slide, docx, pdf } from "./material-fixtures.mjs";
import { initialize, withInstanceLock } from "./instance.mjs";

// Exercise the built artifact outside the source tree, so missing dependencies cannot resolve from its parent.
async function verifyStandalone() {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-materials-standalone-"));
  const app = path.join(temporary, "app"), instance = path.join(temporary, "synthetic-instance");
  try {
    await fs.cp(path.join(repo, "study-log-web", ".next-build-cache", "standalone"), app, { recursive: true, dereference: true });
    const realApp = await fs.realpath(app);
    for (const resource of ["legacy/build/pdf.mjs", "legacy/build/pdf.worker.mjs", "standard_fonts/LiberationSans-Regular.ttf", "cmaps/Adobe-GB1-UCS2.bcmap"]) {
      const relative = path.relative(realApp, await fs.realpath(path.join(app, "node_modules", "pdfjs-dist", resource)));
      assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), "PDF resource escaped standalone directory");
    }
    await initialize(instance);
    const environment = parseEnv(await fs.readFile(path.join(instance, ".env"), "utf8"));
    const port = await new Promise(resolve => {
      const listener = net.createServer();
      listener.listen(0, "127.0.0.1", () => { const port = listener.address().port; listener.close(() => resolve(port)); });
    });
    const base = `http://127.0.0.1:${port}/study-log`;
    await withInstanceLock(path.join(instance, "data"), async () => {
      const server = spawn(process.execPath, ["server.js"], { cwd: app, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, ...environment,
        LOG_ROOT: path.join(instance, "data"), BACKUP_ROOT: path.join(instance, "backups"), NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1"
      } });
      let logs = "";
      server.stdout.on("data", chunk => { logs += chunk; }); server.stderr.on("data", chunk => { logs += chunk; });
      const closed = new Promise(resolve => server.once("exit", resolve));
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try { if ((await fetch(`${base}/api/capabilities`)).status === 401) { ready = true; break; } } catch {}
          if (server.exitCode !== null) break;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(ready, `Standalone did not start: ${logs}`);
        const before = await fs.readdir(path.join(instance, "data"));
        const smoke = spawn(process.execPath, [fileURLToPath(import.meta.url), instance, base], { cwd: repo, stdio: "inherit", windowsHide: true });
        assert.equal(await new Promise(resolve => smoke.once("exit", resolve)), 0, "Standalone HTTP smoke failed");
        assert.deepEqual(await fs.readdir(path.join(instance, "data")), before);
        assert.deepEqual(await fs.readdir(path.join(instance, "backups")), []);
        console.log("PASS relocated standalone runtime, worker/fonts/cmaps, isolated instance; no log/backup files created");
      } finally { server.kill(); await closed; }
    });
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("workbench-materials-standalone-"));
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[2] === "--standalone") { await verifyStandalone(); process.exit(0); }

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

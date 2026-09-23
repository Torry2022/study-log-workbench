import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const [root, base, from] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith("web-gate-") || !base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("Usage: node ops/browser-web-gate.mjs ABSOLUTE_SYNTHETIC_web-gate-ROOT LOOPBACK_URL [START_SCRIPT]");
}
const scripts = [
  "auth", "reader", "reader-lifecycle", "reader-overlays", "calendar",
  "editor", "editor-lifecycle", "reading-position", "attachments", "internal-links",
  "backups", "search", "favorites", "favorites-navigation", "notes", "stats", "export",
  "writing", "highlighting", "note-candidates", "taxonomy-ai",
];
const start = from ? scripts.indexOf(from) : 0;
if (start < 0) throw new Error("Unknown starting script");
const directory = path.join(root, "artifacts", "web-gate");
await fs.mkdir(directory, { recursive: true });
const reportFile = path.join(directory, "results.json");
const buildFile = new URL("../study-log-web/.next-build-cache/BUILD_ID", import.meta.url);
const buildId = (await fs.readFile(buildFile, "utf8")).trim();
const report = from ? JSON.parse(await fs.readFile(reportFile, "utf8")) : { root, base, buildId, startedAt: new Date().toISOString(), attempts: [] };
if (report.buildId !== buildId) throw new Error("Build changed since the previous run; use a new fixture and complete regression");
for (const name of scripts.slice(start)) {
  if ((await fs.readFile(buildFile, "utf8")).trim() !== buildId) throw new Error("Build changed during regression");
  const script = fileURLToPath(new URL(`browser-${name}.mjs`, import.meta.url));
  const startedAt = new Date().toISOString();
  const begin = Date.now();
  const logFile = path.join(directory, `${name}-${report.attempts.length + 1}.log`);
  console.log(`START ${name}`);
  let output = "", timedOut = false;
  const child = spawn(process.execPath, [script, root, base], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const append = chunk => { output = (output + chunk.toString()).slice(-1_000_000); };
  child.stdout.on("data", append); child.stderr.on("data", append);
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 150_000);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  clearTimeout(timer);
  await fs.writeFile(logFile, output);
  const stableBuild = (await fs.readFile(buildFile, "utf8")).trim() === buildId;
  const result = { script: `ops/browser-${name}.mjs`, startedAt, elapsedMs: Date.now() - begin, code, timedOut, stableBuild, logFile };
  report.attempts.push(result);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`${code === 0 && !timedOut && stableBuild ? "PASS" : "FAIL"} ${name} ${result.elapsedMs}ms`);
  if (code !== 0 || timedOut || !stableBuild) { console.log(output); process.exitCode = 1; break; }
}
console.log(`Report: ${reportFile}`);

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getBackupRoot, getLogRoot } from "./config.ts";
import { normalizeHeading } from "./stats-tags.ts";
import type { SaveTaxonomyInput, Taxonomy } from "./stats-types.ts";

const FILE_NAME = ".study-log-taxonomy.json";
const OTHER = "其他";
const queues = new Map<string, Promise<unknown>>();
export class TaxonomyInputError extends Error {}
export class TaxonomyConflictError extends Error {
  constructor() { super("分类已被其他操作修改，请重新读取后再保存"); }
}
const versionOf = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

function normalize(input: unknown): Pick<Taxonomy, "domains" | "mappings"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TaxonomyInputError("分类设置格式无效，请重新读取后重试");
  const value = input as SaveTaxonomyInput;
  if (!Array.isArray(value.domains) || !value.domains.every(domain => typeof domain === "string" && domain.trim()) ||
    !value.mappings || typeof value.mappings !== "object" || Array.isArray(value.mappings) ||
    !Object.values(value.mappings).every(domain => typeof domain === "string")) throw new TaxonomyInputError("领域与映射格式无效");
  const domains = [...new Set(value.domains.map(domain => domain.trim()).filter(domain => domain !== OTHER)), OTHER];
  const allowed = new Set(domains);
  const mappings = Object.fromEntries(Object.entries(value.mappings).map(([tag, domain]) => {
    const normalizedTag = normalizeHeading(tag);
    if (!normalizedTag) throw new TaxonomyInputError("映射标签不能为空");
    return [normalizedTag, allowed.has(domain.trim()) ? domain.trim() : OTHER];
  }));
  return { domains, mappings };
}

async function checkDirectory(directory: string): Promise<void> {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid taxonomy directory");
  }
}
async function checkFile(root: string, file: string): Promise<boolean> {
  await checkDirectory(root);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid taxonomy file");
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function readSnapshot(root: string): Promise<{ taxonomy: Taxonomy; raw: string | null }> {
  const file = path.join(root, FILE_NAME);
  if (!await checkFile(root, file)) return { taxonomy: { domains: [OTHER], mappings: {}, updatedAt: null, version: null }, raw: null };
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    const data = normalize(parsed);
    if (parsed.updatedAt !== null && typeof parsed.updatedAt !== "string") throw new Error();
    return { taxonomy: { ...data, updatedAt: parsed.updatedAt, version: versionOf(raw) }, raw };
  } catch { throw new Error("Invalid stored taxonomy data"); }
}
function queued<T>(root: string, task: () => Promise<T>): Promise<T> {
  const result = (queues.get(root) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(root, result);
  void result.finally(() => { if (queues.get(root) === result) queues.delete(root); }).catch(() => {});
  return result;
}
export function readTaxonomy(): Promise<Taxonomy> {
  const root = getLogRoot();
  return queued(root, async () => (await readSnapshot(root)).taxonomy);
}

export async function writeTaxonomy(input: SaveTaxonomyInput): Promise<Taxonomy> {
  const normalized = normalize(input);
  if (!Object.hasOwn(input, "baseVersion") || (input.baseVersion !== null && (typeof input.baseVersion !== "string" || !input.baseVersion))) {
    throw new TaxonomyInputError("无法确认分类设置的当前版本，请重新读取后重试");
  }
  const root = getLogRoot();
  const backupRoot = getBackupRoot();
  return queued(root, async () => {
    const current = await readSnapshot(root);
    if (input.baseVersion !== current.taxonomy.version) throw new TaxonomyConflictError();
    const stored = { ...normalized, updatedAt: new Date().toISOString() };
    const raw = `${JSON.stringify(stored, null, 2)}\n`;
    const file = path.join(root, FILE_NAME);
    const temp = path.join(root, `${FILE_NAME}.${crypto.randomUUID()}.tmp`);
    let created = false;
    try {
      if (current.raw !== null) {
        await checkDirectory(backupRoot);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = path.join(backupRoot, `${FILE_NAME}.${stamp}.${crypto.randomUUID()}.bak`);
        const handle = await fs.open(backup, "wx", 0o600);
        try { await handle.writeFile(current.raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
      }
      const handle = await fs.open(temp, "wx", 0o600); created = true;
      try { await handle.writeFile(raw, "utf8"); await handle.sync(); } finally { await handle.close(); }
      const latest = await readSnapshot(root);
      if (latest.taxonomy.version !== current.taxonomy.version) throw new TaxonomyConflictError();
      await checkFile(root, temp);
      await fs.rename(temp, file);
      return { ...stored, version: versionOf(raw) };
    } finally {
      if (created) await checkFile(root, temp).then(exists => exists ? fs.unlink(temp) : undefined).catch(() => {});
    }
  });
}

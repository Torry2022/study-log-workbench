import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogRoot } from "./config.ts";
import { getDay } from "./log-store.ts";
import { isValidLogDate } from "./study-date.ts";
import { findRootAtxHeadings } from "./day-content.ts";
import { buildMarkdownOutline } from "./markdown-outline.ts";
import type { FavoriteGroup, FavoriteHeading, FavoriteHeadingInput, FavoritesSnapshot } from "./favorites-types.ts";

interface FavoriteRecord extends FavoriteHeadingInput { id: string; groupIds: string[]; createdAt: string; updatedAt: string }
interface FavoritesFile { favorites: FavoriteRecord[]; groups: FavoriteGroup[] }
const FILE_NAME = ".study-log-favorites.json";
const queues = new Map<string, Promise<unknown>>();
export class FavoriteInputError extends Error {}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new FavoriteInputError(`${field}不能为空`);
  return value.trim();
}

// The instance root and all its ancestors are part of the storage boundary.
async function checkedRoot(root: string): Promise<void> {
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Invalid favorites root");
  }
}
async function checkedFile(root: string, file: string): Promise<boolean> {
  await checkedRoot(root);
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Invalid favorites file");
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

function isRecord(value: unknown): value is FavoriteRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as FavoriteRecord;
  return [record.id, record.headingText, record.headingId, record.createdAt, record.updatedAt].every(item => typeof item === "string" && Boolean(item.trim())) &&
    typeof record.date === "string" && isValidLogDate(record.date) && record.level === 3 &&
    Array.isArray(record.groupIds) && record.groupIds.every(id => typeof id === "string");
}
function isGroup(value: unknown): value is FavoriteGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as FavoriteGroup;
  return [group.id, group.name, group.createdAt, group.updatedAt].every(item => typeof item === "string" && Boolean(item.trim())) && Number.isFinite(group.order);
}
async function readFile(root: string): Promise<FavoritesFile> {
  const file = path.join(root, FILE_NAME);
  if (!await checkedFile(root, file)) return { favorites: [], groups: [] };
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid favorites data");
  const data = parsed as FavoritesFile;
  if (!Array.isArray(data.favorites) || !data.favorites.every(isRecord) || !Array.isArray(data.groups) || !data.groups.every(isGroup) ||
    new Set(data.favorites.map(item => item.id)).size !== data.favorites.length || new Set(data.groups.map(item => item.id)).size !== data.groups.length) {
    throw new Error("Invalid favorites data");
  }
  return data;
}

async function writeFile(root: string, data: FavoritesFile): Promise<void> {
  const target = path.join(root, FILE_NAME);
  await checkedFile(root, target);
  const temp = path.join(root, `${FILE_NAME}.${crypto.randomUUID()}.tmp`);
  let created = false;
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    created = true;
    try { await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await checkedFile(root, target);
    await checkedFile(root, temp);
    await fs.rename(temp, target);
  } finally {
    if (created) {
      await checkedFile(root, temp).then(exists => exists ? fs.unlink(temp) : undefined).catch(() => {});
    }
  }
}

function withRootQueue<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(root, next);
  void next.finally(() => { if (queues.get(root) === next) queues.delete(root); }).catch(() => {});
  return next;
}
function mutate<T>(task: (file: FavoritesFile) => Promise<T> | T): Promise<T> {
  const root = getLogRoot();
  return withRootQueue(root, async () => {
    const file = await readFile(root);
    const result = await task(file);
    await writeFile(root, file);
    return result;
  });
}
function readSnapshot(): Promise<FavoritesFile> {
  const root = getLogRoot();
  // Windows can refuse rename while a reader holds the target open.
  return withRootQueue(root, () => readFile(root));
}

function plainText(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ").replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/^#{1,6}\s+.+$/gm, " ")
    .replace(/[*_`>|-]/g, " ").replace(/\s+/g, " ").trim();
}

async function resolveFavorite(record: FavoriteRecord): Promise<FavoriteHeading> {
  const day = await getDay(record.date);
  const headings = day.exists ? buildMarkdownOutline(day.content).filter(item => item.level === 3) : [];
  const resolved = headings.find(item => item.id === record.headingId && item.text === record.headingText) ||
    headings.find(item => item.text === record.headingText);
  let sectionSearchText = "";
  if (resolved) {
    const nodes = findRootAtxHeadings(day.content);
    const index = nodes.findIndex(node => node.line === resolved.line);
    const current = nodes[index];
    const next = nodes.slice(index + 1).find(node => node.level <= current.level);
    sectionSearchText = plainText(day.content.slice(current.end, next?.start ?? day.content.length)).slice(0, 12000);
  }
  return { ...record, month: record.date.slice(0, 7), resolvedHeadingId: resolved?.id || null,
    sectionSearchText, sectionPreview: sectionSearchText.slice(0, 180), exists: Boolean(resolved) };
}

/** Favorites and groups share one JSON snapshot. */
export async function listFavoritesSnapshot(): Promise<FavoritesSnapshot> {
  const file = await readSnapshot();
  const favorites = await Promise.all(file.favorites.map(resolveFavorite));
  return { favorites: favorites.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), groups: file.groups.sort((a, b) => a.order - b.order) };
}
export async function listFavorites(): Promise<FavoriteHeading[]> { return (await listFavoritesSnapshot()).favorites; }
export async function listFavoriteGroups(): Promise<FavoriteGroup[]> {
  return (await readSnapshot()).groups.sort((a, b) => a.order - b.order);
}

export async function addFavorite(input: FavoriteHeadingInput): Promise<FavoriteHeading> {
  if (!input || typeof input.date !== "string" || !isValidLogDate(input.date)) throw new FavoriteInputError("日期无效");
  if (input.level !== 3) throw new FavoriteInputError("仅支持收藏三级小节");
  const headingText = requiredText(input.headingText, "小节标题"), headingId = requiredText(input.headingId, "小节标识");
  return mutate(async file => {
    const id = crypto.createHash("sha1").update(`${input.date}\n${headingId}\n${headingText}`).digest("hex").slice(0, 16);
    const now = new Date().toISOString();
    let record = file.favorites.find(item => item.id === id);
    if (record) record.updatedAt = now;
    else { record = { id, date: input.date, headingText, headingId, level: 3, groupIds: [], createdAt: now, updatedAt: now }; file.favorites.push(record); }
    return resolveFavorite(record);
  });
}
export async function removeFavorite(id: string): Promise<void> {
  const target = requiredText(id, "收藏标识");
  return mutate(file => { file.favorites = file.favorites.filter(item => item.id !== target); });
}
export async function createFavoriteGroup(name: string): Promise<FavoriteGroup> {
  const value = requiredText(name, "分组名称");
  return mutate(file => {
    const existing = file.groups.find(item => item.name === value);
    if (existing) return existing;
    const now = new Date().toISOString();
    const group = { id: crypto.randomUUID(), name: value, order: file.groups.reduce((max, item) => Math.max(max, item.order), 0) + 1, createdAt: now, updatedAt: now };
    file.groups.push(group); return group;
  });
}
export async function renameFavoriteGroup(id: string, name: string): Promise<FavoriteGroup> {
  const target = requiredText(id, "分组标识"), value = requiredText(name, "分组名称");
  return mutate(file => {
    const group = file.groups.find(item => item.id === target);
    if (!group) throw new FavoriteInputError("收藏分组不存在");
    if (file.groups.some(item => item.id !== target && item.name === value)) throw new FavoriteInputError("已存在同名收藏分组");
    group.name = value; group.updatedAt = new Date().toISOString(); return group;
  });
}
export async function removeFavoriteGroup(id: string): Promise<void> {
  const target = requiredText(id, "分组标识");
  return mutate(file => {
    file.groups = file.groups.filter(item => item.id !== target);
    for (const favorite of file.favorites) favorite.groupIds = favorite.groupIds.filter(groupId => groupId !== target);
  });
}
export async function updateFavoriteGroups(id: string, groupIds: unknown): Promise<FavoriteHeading> {
  const target = requiredText(id, "收藏标识");
  if (!Array.isArray(groupIds) || !groupIds.every(item => typeof item === "string")) throw new FavoriteInputError("groupIds必须是字符串数组");
  return mutate(async file => {
    const favorite = file.favorites.find(item => item.id === target);
    if (!favorite) throw new FavoriteInputError("收藏不存在");
    const allowed = new Set(file.groups.map(item => item.id));
    favorite.groupIds = [...new Set(groupIds.filter(item => allowed.has(item)))];
    favorite.updatedAt = new Date().toISOString();
    return resolveFavorite(favorite);
  });
}

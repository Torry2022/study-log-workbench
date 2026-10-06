import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getBackupRoot, getLogRoot } from "./config.ts";
import { MAX_WRITING_PROMPT_BYTES, readWritingPrompt, WritingPromptError } from "./ai-prompts.ts";
import { LEGACY_GENERATION_PRESET, type GenerationPreset, type GenerationPresetsSnapshot } from "./generation-presets-types.ts";

const COMMON = "依据材料记录实际学习内容，保留必要的术语、代码、例子、条件与限制。材料不足时不要虚构亲历、实验、掌握程度、数据或结论；不要求用户填满固定栏目。输出供用户审阅的 Markdown 日志正文。";
const BUILT_INS: GenerationPreset[] = [
  { id: "builtin:daily", name: "日常学习整理", readOnly: true, prompt: `${COMMON}\n将当天的零散笔记、阅读线索和疑问整理为清楚的学习记录。按实际主题组织，简短材料保持简短；将尚未解决的问题与已有结论区分。` },
  { id: "builtin:concepts", name: "概念与例题", readOnly: true, prompt: `${COMMON}\n围绕材料中的技术概念、原理与例题组织。保留概念的适用条件、推导或例题步骤；仅在材料支持时比较易混概念，不自行编造用户做过的练习。` },
  { id: "builtin:practice", name: "实践与排错", readOnly: true, prompt: `${COMMON}\n整理项目实践或排错过程，区分目标、环境、现象、尝试、证据和结果。只保留材料实际提供的环节，明确尚未证实的推测，不把计划写成已完成操作。` }
];
const FILE_NAME = "generation-presets.json";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PRESETS = 50;
const queues = new Map<string, Promise<unknown>>();
interface PresetsFile { schemaVersion: 1; defaultPresetId: string; presets: GenerationPreset[] }
export class GenerationPresetError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, status = 400, code = "GENERATION_PRESET_INVALID") {
    super(message); this.status = status; this.code = code;
  }
}

function withQueue<T>(root: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(root) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(root, next);
  void next.finally(() => { if (queues.get(root) === next) queues.delete(root); }).catch(() => {});
  return next;
}
async function checkedDirectory(directory: string, allowMissing = false): Promise<void> {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch(error => {
      if (allowMissing && error.code === "ENOENT") return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Invalid preset directory");
  }
}
async function readRaw(file: string): Promise<string | null> {
  await checkedDirectory(path.dirname(file));
  const stat = await fs.lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error("Invalid preset file");
  const handle = await fs.open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true }), current = await fs.lstat(file, { bigint: true });
    if (!opened.isFile() || current.isSymbolicLink() || opened.ino !== current.ino || (process.platform !== "win32" && opened.dev !== current.dev)) throw new Error("Preset file changed");
    const bytes = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_FILE_BYTES) throw new Error("Preset file too large");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
}
function text(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes || value.includes("\0")) {
    throw new GenerationPresetError(`${name}不能为空或超过${name === "方案名称" ? "80 个字符" : "64 KiB"}`);
  }
  return value.trim();
}
function name(value: unknown): string {
  const result = text(value, "方案名称", 320);
  if (Array.from(result).length > 80 || /[\r\n]/.test(result)) throw new GenerationPresetError("方案名称不能超过 80 个字符或包含换行");
  return result;
}
function personalId(value: unknown): value is string { return typeof value === "string" && /^user:[a-f0-9-]{36}$/.test(value); }
function hasPreset(file: PresetsFile, id: string): boolean {
  return id === LEGACY_GENERATION_PRESET || BUILT_INS.some(item => item.id === id) || file.presets.some(item => item.id === id);
}
function version(raw: string | null): string { return crypto.createHash("sha256").update(raw ?? "").digest("hex"); }
async function readFile(root: string): Promise<{ file: PresetsFile; raw: string | null }> {
  await checkedDirectory(root);
  const directory = path.join(root, "prompts");
  await checkedDirectory(directory);
  const raw = await readRaw(path.join(directory, FILE_NAME));
  if (raw === null) return { raw, file: { schemaVersion: 1, defaultPresetId: LEGACY_GENERATION_PRESET, presets: [] } };
  const value = JSON.parse(raw) as PresetsFile;
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.presets) || value.presets.length > MAX_PRESETS ||
      typeof value.defaultPresetId !== "string") throw new Error("Invalid preset data");
  for (const preset of value.presets) {
    if (!preset || !personalId(preset.id) || preset.readOnly !== false || name(preset.name) !== preset.name ||
        text(preset.prompt, "提示词", MAX_WRITING_PROMPT_BYTES) !== preset.prompt) throw new Error("Invalid preset record");
  }
  if (new Set(value.presets.map(item => item.id)).size !== value.presets.length ||
      new Set(value.presets.map(item => item.name)).size !== value.presets.length || !hasPreset(value, value.defaultPresetId)) throw new Error("Invalid preset identity");
  return { raw, file: value };
}
async function snapshot(file: PresetsFile, raw: string | null): Promise<GenerationPresetsSnapshot> {
  const legacy: GenerationPreset = { id: LEGACY_GENERATION_PRESET, name: "现有默认方案", prompt: "", readOnly: true };
  try { legacy.prompt = await readWritingPrompt("generation"); }
  catch (error) { if (!(error instanceof WritingPromptError)) throw error; legacy.issue = error.message; }
  return { version: version(raw), defaultPresetId: file.defaultPresetId, presets: [legacy, ...BUILT_INS.map(item => ({ ...item })), ...file.presets] };
}
export async function listGenerationPresets(): Promise<GenerationPresetsSnapshot> {
  const root = getLogRoot();
  return withQueue(root, async () => { const { file, raw } = await readFile(root); return snapshot(file, raw); });
}

export type PresetMutation =
  | { action: "create"; version: unknown; name: unknown; prompt: unknown }
  | { action: "update"; version: unknown; id: unknown; name: unknown; prompt: unknown }
  | { action: "default"; version: unknown; defaultPresetId: unknown }
  | { action: "delete"; version: unknown; id: unknown };

export async function mutateGenerationPresets(input: PresetMutation): Promise<GenerationPresetsSnapshot> {
  const root = getLogRoot();
  return withQueue(root, async () => {
    const { file, raw } = await readFile(root);
    if (input.version !== version(raw)) throw new GenerationPresetError("方案已在其他页面修改，请刷新列表后重试；未保存的内容已保留。", 409, "GENERATION_PRESET_CONFLICT");
    if (input.action === "create" || input.action === "update") {
      const presetName = name(input.name), prompt = text(input.prompt, "提示词", MAX_WRITING_PROMPT_BYTES);
      if (file.presets.some(item => item.name === presetName && (input.action === "create" || item.id !== input.id))) throw new GenerationPresetError("已有同名个人方案");
      if (input.action === "create") {
        if (file.presets.length >= MAX_PRESETS) throw new GenerationPresetError("个人方案最多保存 50 个");
        file.presets.push({ id: `user:${crypto.randomUUID()}`, name: presetName, prompt, readOnly: false });
      } else {
        const item = file.presets.find(preset => preset.id === input.id);
        if (!item) throw new GenerationPresetError("只能编辑已存在的个人方案", 404, "GENERATION_PRESET_NOT_FOUND");
        item.name = presetName; item.prompt = prompt;
      }
    } else if (input.action === "default") {
      if (typeof input.defaultPresetId !== "string" || !hasPreset(file, input.defaultPresetId)) throw new GenerationPresetError("默认方案不存在", 404, "GENERATION_PRESET_NOT_FOUND");
      file.defaultPresetId = input.defaultPresetId;
    } else {
      if (!personalId(input.id) || !file.presets.some(item => item.id === input.id)) throw new GenerationPresetError("只能删除已存在的个人方案", 404, "GENERATION_PRESET_NOT_FOUND");
      file.presets = file.presets.filter(item => item.id !== input.id);
      if (file.defaultPresetId === input.id) file.defaultPresetId = LEGACY_GENERATION_PRESET;
    }
    const target = path.join(root, "prompts", FILE_NAME);
    const next = `${JSON.stringify(file, null, 2)}\n`;
    if (Buffer.byteLength(next) > MAX_FILE_BYTES) throw new GenerationPresetError("方案文件过大，请缩短提示词");
    if (raw !== null) {
      const backup = getBackupRoot();
      await checkedDirectory(backup, true); await fs.mkdir(backup, { recursive: true, mode: 0o700 }); await checkedDirectory(backup);
      await fs.writeFile(path.join(backup, `${FILE_NAME}.${crypto.randomUUID()}.bak`), raw, { flag: "wx", mode: 0o600 });
    }
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    let created = false;
    try {
      const handle = await fs.open(temp, "wx", 0o600); created = true;
      try { await handle.writeFile(next, "utf8"); await handle.sync(); } finally { await handle.close(); }
      if (await readRaw(target) !== raw) throw new GenerationPresetError("方案文件已变更，请刷新后重试。", 409, "GENERATION_PRESET_CONFLICT");
      await fs.rename(temp, target);
    } finally { if (created) await fs.unlink(temp).catch(() => {}); }
    return snapshot(file, next);
  });
}

export async function readGenerationPreset(id?: string): Promise<string> {
  if (id === undefined || id === LEGACY_GENERATION_PRESET) return readWritingPrompt("generation");
  const root = getLogRoot();
  return withQueue(root, async () => {
    const { file } = await readFile(root);
    const preset = BUILT_INS.find(item => item.id === id) || file.presets.find(item => item.id === id);
    if (!preset) throw new GenerationPresetError("所选生成方案已不存在，请重新选择。", 404, "GENERATION_PRESET_NOT_FOUND");
    return preset.prompt;
  });
}

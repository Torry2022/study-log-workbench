import { LEGACY_GENERATION_PRESET, type GenerationPresetsSnapshot } from "./generation-presets-types.ts";

export function parseGenerationPresets(value: unknown): GenerationPresetsSnapshot {
  if (!value || typeof value !== "object") throw new Error("生成方案响应无效，请重试");
  const payload = value as GenerationPresetsSnapshot;
  if (typeof payload.version !== "string" || !/^[a-f0-9]{64}$/.test(payload.version) ||
      typeof payload.defaultPresetId !== "string" || !Array.isArray(payload.presets) ||
      !payload.presets.every(item => item && typeof item.id === "string" && typeof item.name === "string" &&
        typeof item.prompt === "string" && typeof item.readOnly === "boolean" && (item.issue === undefined || typeof item.issue === "string")) ||
      new Set(payload.presets.map(item => item.id)).size !== payload.presets.length ||
      !payload.presets.some(item => item.id === payload.defaultPresetId) ||
      !payload.presets.some(item => item.id === LEGACY_GENERATION_PRESET)) throw new Error("生成方案响应无效，请重试");
  return payload;
}

export function survivingPresetSelection(snapshot: GenerationPresetsSnapshot, selectedId: string): string {
  return snapshot.presets.some(item => item.id === selectedId) ? selectedId : snapshot.defaultPresetId;
}

export interface GenerationPreset {
  id: string;
  name: string;
  prompt: string;
  readOnly: boolean;
  issue?: string;
}

export interface GenerationPresetsSnapshot {
  version: string;
  defaultPresetId: string;
  presets: GenerationPreset[];
}

export const LEGACY_GENERATION_PRESET = "legacy";

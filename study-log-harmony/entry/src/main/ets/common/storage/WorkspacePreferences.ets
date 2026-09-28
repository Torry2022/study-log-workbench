import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

export const READING_SCALES: number[] = [0.9, 1, 1.1, 1.2];
export const EDITOR_SIZES: number[] = [12, 14, 16, 18, 20];

interface PreferenceDefault { key: string; value: number | string | boolean; }
const DEFAULTS: PreferenceDefault[] = [
  { key: 'readingScale', value: 1 }, { key: 'editorSize', value: 14 },
  { key: 'editorWrap', value: true }, { key: 'rememberSearch', value: true },
  { key: 'favoritesView', value: 'list' }, { key: 'favoritesSort', value: 'log_date' },
  { key: 'shareGuideSeen', value: false },
  { key: 'sidebarCollapsed0', value: false },
  { key: 'sidebarCollapsed1', value: false },
  { key: 'sidebarCollapsed2', value: false },
  { key: 'sidebarCollapsed3', value: false },
  { key: 'sidebarCollapsed4', value: false }
];

export function validPreference(key: string, value: preferences.ValueType): boolean {
  if (/^sidebarCollapsed[0-4]$/.test(key)) return typeof value === 'boolean';
  if (key === 'readingScale') return typeof value === 'number' && READING_SCALES.includes(value);
  if (key === 'editorSize') return typeof value === 'number' && EDITOR_SIZES.includes(value);
  if (key === 'editorWrap' || key === 'rememberSearch' || key === 'shareGuideSeen') return typeof value === 'boolean';
  if (key === 'favoritesView') return value === 'list' || value === 'grid';
  if (key === 'favoritesSort') return value === 'log_date' || value === 'saved_date';
  return false;
}

class WorkspacePreferences {
  private store?: preferences.Preferences;
  private pending: Promise<void> = Promise.resolve();

  async initialize(context: common.Context): Promise<void> {
    try {
      this.store = await preferences.getPreferences(context.getApplicationContext(),
        { name: 'study_log_public_settings' });
    } catch (_) { this.store = undefined; }
    for (const entry of DEFAULTS) {
      const key = entry.key;
      let value: preferences.ValueType = entry.value;
      try { value = await this.store?.get(key, value) ?? value; } catch (_) { /* Use this field's default. */ }
      AppStorage.setOrCreate(`pref_${key}`, validPreference(key, value) ? value : entry.value);
    }
  }

  set(key: string, value: preferences.ValueType): Promise<void> {
    if (!validPreference(key, value)) return Promise.reject(new Error('设置值无效'));
    const write = this.pending.then(async () => {
      if (!this.store) throw new Error('无法保存本机设置，请重启应用后重试');
      await this.store.put(key, value);
      await this.store.flush();
      AppStorage.setOrCreate(`pref_${key}`, value);
    });
    this.pending = write.catch(() => {});
    return write;
  }

  async resetSettings(): Promise<void> {
    for (const entry of DEFAULTS.slice(0, 4)) {
      await this.set(entry.key, entry.value);
    }
  }
}

export const workspacePreferences = new WorkspacePreferences();

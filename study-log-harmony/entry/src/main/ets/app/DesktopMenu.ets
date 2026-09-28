import { window } from '@kit.ArkUI';

export class DesktopWindow {
  static mainWindow: window.Window | undefined = undefined;
}

export class DesktopMenuEntry {
  id: string;
  label: string;
  enabled: boolean;
  checked: boolean;
  shortcut: string;

  constructor(id: string, label: string, enabled: boolean = true, checked: boolean = false, shortcut: string = '') {
    this.id = id;
    this.label = label;
    this.enabled = enabled;
    this.checked = checked;
    this.shortcut = shortcut;
  }
}

// The page owns availability and execution; title menus only expose its existing commands.
export class DesktopLogCommands {
  entries: (menu: string) => DesktopMenuEntry[] = () => [];
  execute: (id: string) => void = () => {};
  handleKey: (event: KeyEvent) => boolean = () => false;
  editing: () => boolean = () => false;
  editorFocused: () => boolean = () => false;
  blocked: () => boolean = () => false;
  navigate: (offset: number) => void = () => {};
}

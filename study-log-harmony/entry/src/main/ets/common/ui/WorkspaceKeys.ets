import { KeyCode } from '@kit.InputKit';

// Exact modifiers avoid hijacking text selection and the editor's own keymap.
export function workspaceKey(event: KeyEvent, key: KeyCode, ctrl: boolean = false,
  shift: boolean = false, alt: boolean = false): boolean {
  return event.type === KeyType.Down && event.keyCode === key &&
    !!event.getModifierKeyState?.(['Ctrl']) === ctrl && !!event.getModifierKeyState?.(['Shift']) === shift &&
    !!event.getModifierKeyState?.(['Alt']) === alt;
}

export function textNavigationKey(event: KeyEvent): boolean {
  return workspaceKey(event, KeyCode.KEYCODE_DPAD_UP, false, false, true) ||
    workspaceKey(event, KeyCode.KEYCODE_DPAD_LEFT, false, false, true) ||
    workspaceKey(event, KeyCode.KEYCODE_DPAD_RIGHT, false, false, true);
}

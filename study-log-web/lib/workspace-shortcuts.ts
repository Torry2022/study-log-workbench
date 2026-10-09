/** Global commands must leave modal dialogs and text editing in control. */
export function workspaceShortcutBlocked(event?: KeyboardEvent) {
  if (event?.defaultPrevented || event?.isComposing || event?.repeat) return true;
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"]'))
    .some(element => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
}

export function isEditingTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .cm-editor'));
}

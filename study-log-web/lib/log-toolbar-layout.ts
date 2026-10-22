// Preserve the established action priority, using their rendered widths rather than viewport guesses.
const steps = [
  "compact-secondary", "compact-delete", "compact-backup", "compact-export",
  "compact-refresh", "compact-save", "compact-mode", "compact-navigation",
  "overflow-secondary", "overflow-delete", "overflow-backup", "overflow-export",
  "overflow-refresh", "select-mode", "overflow-navigation"
];

export function fitLogToolbar(controls: HTMLElement) {
  if (!window.matchMedia("(min-width: 1024px)").matches || !controls.getClientRects().length) {
    delete controls.dataset.toolbarLayout;
    return;
  }
  for (let count = 0; count <= steps.length; count++) {
    controls.dataset.toolbarLayout = steps.slice(0, count).join(" ");
    const groups = [...controls.children].filter(element => element.getClientRects().length);
    const gap = parseFloat(getComputedStyle(controls).columnGap) || 0;
    const required = groups.reduce((width, element) => width + element.getBoundingClientRect().width, 0) + gap * Math.max(0, groups.length - 1);
    if (required <= controls.clientWidth + 0.5) break;
  }
}

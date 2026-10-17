import { UIContext } from '@kit.ArkUI';

export function keyboardFrameInset(viewportBottom: number, keyboardTop: number): number {
  return keyboardTop > 0 ? Math.max(0, viewportBottom - keyboardTop) : 0;
}

// Reveal adjacent feedback/actions without scrolling the focused field out of view.
export function formKeyboardOffset(viewportTop: number, viewportBottom: number, fieldTop: number,
  regionBottom: number, currentOffset: number, fieldHeight: number = 48): number {
  if (fieldTop < viewportTop + 8 && fieldHeight <= viewportBottom - viewportTop - 16) {
    return Math.max(0, currentOffset + fieldTop - viewportTop - 8);
  }
  const hidden = Math.max(0, regionBottom + 8 - viewportBottom);
  const available = Math.max(0, fieldTop - 8 - viewportTop);
  return currentOffset + Math.min(hidden, available);
}

export class FormKeyboardContext {
  private fieldId: string = '';
  private regionId: string = '';
  private scroller: Scroller;
  private viewportId: string;

  constructor(scroller: Scroller, viewportId: string) {
    this.scroller = scroller;
    this.viewportId = viewportId;
  }

  focus(context: UIContext, fieldId: string, regionId: string): void {
    this.fieldId = fieldId;
    this.regionId = regionId;
    this.reveal(context);
  }

  blur(fieldId: string): void {
    if (this.fieldId === fieldId) this.clear();
  }

  clear(): void { this.fieldId = ''; this.regionId = ''; }

  reveal(context: UIContext): void {
    if (!this.fieldId || !AppStorage.get<boolean>('softwareKeyboardVisible')) return;
    try {
      const geometry = context.getComponentUtils();
      const viewport = geometry.getRectangleById(this.viewportId);
      const field = geometry.getRectangleById(this.fieldId);
      const region = geometry.getRectangleById(this.regionId);
      if (viewport.size.height <= 0 || field.size.height <= 0 || region.size.height <= 0) return;
      const current = this.scroller.currentOffset();
      const keyboardTop = AppStorage.get<number>('softwareKeyboardTopPx') || 0;
      const viewportBottom = viewport.windowOffset.y + viewport.size.height;
      const next = formKeyboardOffset(context.px2vp(viewport.windowOffset.y),
        context.px2vp(keyboardTop > 0 ? Math.min(viewportBottom, keyboardTop) : viewportBottom), context.px2vp(field.windowOffset.y),
        context.px2vp(region.windowOffset.y + region.size.height), current.yOffset, context.px2vp(field.size.height));
      if (Math.abs(next - current.yOffset) > 0.5) this.scroller.scrollTo({ xOffset: current.xOffset, yOffset: next });
    } catch (_) { /* A closed or virtualized form no longer has layout geometry. */ }
  }
}

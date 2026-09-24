import { ColorMetrics } from '@kit.ArkUI';
import { drawing } from '@kit.ArkGraphics2D';

// Tint rendered strokes without filling the transparent interiors of line icons.
export function iconTint(color: ResourceColor): drawing.ColorFilter {
  const value = ColorMetrics.resourceColor(color);
  return drawing.ColorFilter.createBlendModeColorFilter({
    alpha: value.alpha, red: value.red, green: value.green, blue: value.blue
  }, drawing.BlendMode.SRC_IN);
}

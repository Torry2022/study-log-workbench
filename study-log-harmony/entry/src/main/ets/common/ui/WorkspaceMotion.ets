import { UIContext } from '@kit.ArkUI';
import { FrameAction } from './FrameAction';

// Fade floating surfaces in place, keeping their full-screen hit area and scrim stationary.
export function floatingSurfaceTransition(): TransitionEffect {
  return TransitionEffect.asymmetric(
    TransitionEffect.OPACITY.animation({ duration: 180, curve: Curve.EaseOut }),
    TransitionEffect.OPACITY.animation({ duration: 140, curve: Curve.EaseIn })
  );
}

export function expandSection(context: UIContext, update: () => void): void {
  context.animateTo({ duration: 180, curve: Curve.EaseInOut }, update);
}

// Start after the mounted panel has a frame; do not guess a render delay with timers.
export function revealPanel(context: UIContext, isMounted: () => boolean, update: () => void): void {
  context.postFrameCallback(new FrameAction(() => {
    if (isMounted()) context.animateTo({ duration: 220, curve: Curve.EaseOut }, update);
  }));
}

// Secondary pages share a small native transition; their underlying page stays mounted.
export function secondaryPageTransition(): TransitionEffect {
  return TransitionEffect.OPACITY.combine(TransitionEffect.translate({ x: 16 }))
    .animation({ duration: 180, curve: Curve.EaseOut });
}

// Update results immediately; only their ink fades in, never their layout dimensions.
export function revealResults(context: UIContext, setOpacity: (value: number) => void,
  isCurrent: () => boolean = () => true): void {
  setOpacity(0.78);
  context.postFrameCallback(new FrameAction(() => {
    if (!isCurrent()) return;
    context.animateTo({ duration: 140, curve: Curve.EaseOut }, () => setOpacity(1));
  }));
}

// Collapse synchronous linked-filter updates into one final result change.
// Each page owns its gate; stale queued work cannot restart a newer transition.
export class ResultChangeGate {
  private key: string = '';
  private revision: number = 0;
  private animationRevision: number = 0;

  reset(key: string): void {
    this.revision += 1;
    this.animationRevision += 1;
    this.key = key;
  }

  async update(key: string, onChange: (isCurrent: () => boolean) => void): Promise<void> {
    const revision = ++this.revision;
    await Promise.resolve();
    if (revision !== this.revision || key === this.key) return;
    this.key = key;
    const animationRevision = ++this.animationRevision;
    onChange(() => animationRevision === this.animationRevision);
  }
}

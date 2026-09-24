import { FrameCallback } from '@kit.ArkUI';

export class FrameAction extends FrameCallback {
  private action: () => void;

  constructor(action: () => void) {
    super();
    this.action = action;
  }

  onIdle(): void { this.action(); }
}

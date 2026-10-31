function mix(a: number, b: number, value: number): number {
  return a + (b - a) * value;
}

function curve(value: number, x1: number, y1: number, x2: number, y2: number): number {
  const p = Math.max(0, Math.min(1, value));
  if (p === 0 || p === 1) return p;
  let low = 0, high = 1, t = p;
  for (let i = 0; i < 18; i++) {
    t = (low + high) / 2;
    const x = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (x < p) low = t;
    else high = t;
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

function sample(time: number, times: number[], values: number[]): number {
  if (time <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (time <= times[i]) return mix(values[i - 1], values[i], (time - times[i - 1]) / (times[i] - times[i - 1]));
  }
  return values[values.length - 1];
}

export class LaunchMotion {
  offset: number = 1;
  x: number = 0;
  y: number = 0;
  scale: number = 1;
  private impactAt: number = -1;

  private horizontal: number;
  private vertical: number;
  private size: number;

  constructor(horizontal: number, vertical: number, size: number = 84) {
    this.horizontal = horizontal;
    this.vertical = vertical;
    this.size = size;
    this.x = horizontal;
    this.y = vertical;
  }

  advance(time: number): void {
    const phase = (time - 300) / 400;
    if (phase <= 0) this.offset = 1;
    else if (phase < .55) this.offset = 1 - curve(phase / .55, .5, 0, .85, .6);
    else if (phase < .68) this.offset = -.035 * curve((phase - .55) / .13, 0, 0, .58, 1);
    else this.offset = sample(phase, [.68, .84, 1], [-.035, .008, 0]);
    this.x = this.offset * (phase < .55 ? this.horizontal : Math.min(this.horizontal, this.size * 3));
    this.y = this.offset * (phase < .55 ? this.vertical : Math.min(this.vertical, this.size));
    if (this.impactAt < 0 && phase < 1) {
      // Node radius 58 and rounded bar radius 29 share the 1024-unit SVG viewBox.
      const unit = this.size * 1.12 / 1024;
      const distance = Math.hypot(140 * unit + this.x, this.y);
      if (distance <= 87 * unit) this.impactAt = time;
    }
    const impact = (time - this.impactAt) / 220;
    this.scale = this.impactAt < 0 ? 1 : sample(curve(impact, 0, 0, .58, 1), [0, .16, .48, 1], [1, .94, 1.035, 1]);
  }
}

export class LaunchDrop {
  x: number = 0;
  y: number = 0;
  dx: number = 0;
  dy: number = 0;
  angle: number = 0;
  size: number = 0;
  duration: number = 0;
  delay: number = 0;
  ink: boolean = false;
  born: number = 0;
  scaleX: number = 1;
  scaleY: number = 1;
  opacity: number = 0;
  neckX: number = 0;
  neckY: number = 0;
  neckOpacity: number = 0;
}

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
  drops: LaunchDrop[] = [];
  private contacts: boolean[] = [false, false];
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
    const unit = this.size * 1.12 / 1024;
    for (let index = 0; index < 2; index++) {
      if (this.contacts[index] || phase >= 1) continue;
      const side = index === 0 ? -1 : 1, y = index === 0 ? 322 : 702;
      const nodeX = (338 - 512) * unit - this.x;
      const nodeY = (y - 512) * unit;
      const x = (478 - 512) * unit - nodeX;
      const dy = side * this.y;
      const distance = Math.hypot(x, dy);
      if (distance > 87 * unit) continue;
      this.contacts[index] = true;
      if (this.impactAt < 0) this.impactAt = time;
      const nx = x / distance, ny = dy / distance, tx = -ny * side, ty = nx * side;
      for (let part = 0; part < 2; part++) {
        const tangent = (side < 0 ? [26, 16] : [23, 19])[part];
        const normal = (side < 0 ? [-9, 12] : [4, -12])[part];
        const drop = new LaunchDrop();
        drop.x = nodeX + nx * 58 * unit;
        drop.y = nodeY + ny * 58 * unit;
        drop.dx = (tx * tangent + nx * normal) * this.size / 72;
        drop.dy = (ty * tangent + ny * normal) * this.size / 72;
        drop.angle = Math.atan2(drop.dy, drop.dx) + Math.PI / 2;
        drop.size = (part === 0 ? 5 : 3) * this.size / 72;
        drop.duration = part === 0 ? (side < 0 ? 460 : 420) : (side < 0 ? 340 : 360);
        drop.delay = part === 0 ? (side < 0 ? 0 : 12) : (side < 0 ? 22 : 0);
        drop.ink = part === 1;
        drop.born = time;
        this.drops.push(drop);
      }
    }
    const impact = (time - this.impactAt) / 220;
    this.scale = this.impactAt < 0 ? 1 : sample(curve(impact, 0, 0, .58, 1), [0, .16, .48, 1], [1, .94, 1.035, 1]);
  }

  frame(drop: LaunchDrop, time: number): LaunchDrop {
    const result = new LaunchDrop();
    const age = time - drop.born - drop.delay, progress = Math.max(0, Math.min(1, age / drop.duration));
    const travel = curve(progress, .15, .5, .35, 1);
    result.x = drop.x + drop.dx * travel;
    result.y = drop.y + drop.dy * travel;
    result.angle = drop.angle;
    result.size = drop.size;
    result.ink = drop.ink;
    const times: number[] = [0, .16, .26, .4, .58, .76, 1];
    result.scaleX = sample(progress, times, [1.25, .6, .72, 1.15, .9, .55, .12]);
    result.scaleY = sample(progress, times, [.65, 2.2, 1.65, .88, .96, .6, .12]);
    result.opacity = age < 0 ? 0 : sample(progress, times, [.95, .95, .95, .9, .75, .4, 0]);
    const neck = Math.max(0, Math.min(1, age / 120));
    result.neckX = sample(neck, [0, .28, .62, 1], [.8, .8, .3, .1]);
    result.neckY = sample(neck, [0, .28, .62, 1], [.1, 1, .95, 0]);
    result.neckOpacity = age < 0 ? 0 : sample(neck, [0, .28, .62, 1], [.8, .8, .65, 0]);
    return result;
  }
}

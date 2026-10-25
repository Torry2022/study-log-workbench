const query = new URLSearchParams(location.search);
const assets = query.get('assets');
if (assets) for (const image of document.querySelectorAll('.mark img')) {
  image.src = new URL(`${image.dataset.theme}/media/launch_${image.dataset.part}.svg`, assets).href;
}
const mark = document.querySelector('.mark');
const contacts = [{ part: 'top', y: 322, side: -1 }, { part: 'bottom', y: 702, side: 1 }].map(contact => ({
  ...contact, hit: false, droplets: Array.from({ length: 2 }, (_unused, index) => {
    const droplet = document.createElement('span');
    droplet.className = index === 1 ? 'droplet ink' : 'droplet';
    mark.append(droplet);
    return droplet;
  })
}));

function watchContact() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches) return;
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'base';
  const image = part => mark.querySelector(`img.${part}[data-theme="${theme}"]`);
  const nodes = image('nodes'), animation = nodes.getAnimations()[0];
  // Landmarks are the node circles and rounded bar starts in the shared SVGs:
  // 1024 viewBox, centered 1.12 scale, node x=338/r=58, bar x=478/r=29.
  const size = mark.clientWidth, unit = size * 1.12 / 1024;
  const coordinate = value => size / 2 + (value - 512) * unit;
  const trace = () => {
    if (reducedMotion.matches) return;
    const nodeShift = new DOMMatrixReadOnly(getComputedStyle(nodes).transform);
    for (const contact of contacts) {
      if (contact.hit) continue;
      const barShift = new DOMMatrixReadOnly(getComputedStyle(image(contact.part)).transform);
      const nodeX = coordinate(338) + nodeShift.m41, nodeY = coordinate(contact.y) + nodeShift.m42;
      const x = coordinate(478) + barShift.m41 - nodeX, y = coordinate(contact.y) + barShift.m42 - nodeY;
      const distance = Math.hypot(x, y);
      if (distance > 87 * unit) continue;
      contact.hit = true; mark.classList.add('contacted');
      const nx = x / distance, ny = y / distance, tx = -ny * contact.side, ty = nx * contact.side;
      const sx = nodeX + nx * 58 * unit - size / 2, sy = nodeY + ny * 58 * unit - size / 2;
      for (const [index, droplet] of contact.droplets.entries()) {
        const tangent = (contact.side < 0 ? [26, 16] : [23, 19])[index];
        const normal = (contact.side < 0 ? [-9, 12] : [4, -12])[index];
        const dx = tx * tangent + nx * normal, dy = ty * tangent + ny * normal;
        const angle = Math.atan2(dy, dx) * 180 / Math.PI - 90;
        for (const [name, value] of Object.entries({ sx: sx + 'px', sy: sy + 'px', dx: sx + dx + 'px', dy: sy + dy + 'px', angle: angle + 'deg', duration: (index ? (contact.side < 0 ? 340 : 360) : (contact.side < 0 ? 460 : 420)) + 'ms', delay: (index ? (contact.side < 0 ? 22 : 0) : (contact.side < 0 ? 0 : 12)) + 'ms' })) {
          droplet.style.setProperty('--' + name, value);
        }
        droplet.classList.add('hit');
      }
    }
    if (contacts.some(contact => !contact.hit) && animation.playState !== 'finished') requestAnimationFrame(trace);
  };
  requestAnimationFrame(trace);
}
const message = document.getElementById('message');
message.textContent = query.get('message') || '正在准备工作台…';
window.startup.onMessage(text => { message.textContent = text; });
window.startup.onShow(() => requestAnimationFrame(() => {
  document.body.classList.add('intro-playing');
  watchContact();
}));
document.querySelector('.close').addEventListener('click', () => window.startup.close());

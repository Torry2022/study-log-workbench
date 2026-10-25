const query = new URLSearchParams(location.search);
const assets = query.get('assets');
if (assets) for (const image of document.querySelectorAll('.mark img')) {
  image.src = new URL(`${image.dataset.theme}/media/launch_${image.dataset.part}.svg`, assets).href;
}
for (let index = 0; index < 28; index++) {
  const angle = index * 2.399963, reach = 84 + index % 5 * 18;
  const x = Math.cos(angle) * reach;
  const fragment = document.createElement('span');
  fragment.className = 'fragment';
  for (const [name, value] of Object.entries({
    sx: Math.cos(angle) * 18 + 'px', sy: Math.sin(angle) * 9 + 'px',
    mx: x + 'px', peak: -32 - index * 17 % 36 + 'px',
    dx: x * 1.15 + 'px', dy: 90 + index * 13 % 46 + 'px',
    turn: (index % 2 ? -1 : 1) * 160 + 'deg', rotation: (index % 2 ? -1 : 1) * (400 + index * 23) + 'deg',
    flip: 460 + index * 47 + 'deg', width: 4 + index % 3 + 'px', height: 7 + index % 4 + 'px',
    delay: index % 4 * 12 + 'ms', duration: 980 + index % 4 * 70 + 'ms'
  })) {
    fragment.style.setProperty('--' + name, value);
  }
  document.querySelector('.mark').append(fragment);
}
const message = document.getElementById('message');
message.textContent = query.get('message') || '正在准备工作台…';
window.startup.onMessage(text => { message.textContent = text; });
window.startup.onShow(() => requestAnimationFrame(() => {
  document.body.classList.add('intro-playing');
}));
document.querySelector('.close').addEventListener('click', () => window.startup.close());

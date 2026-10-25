const query = new URLSearchParams(location.search);
const assets = query.get('assets');
if (assets) for (const image of document.querySelectorAll('.mark img')) {
  image.src = new URL(`${image.dataset.theme}/media/launch_${image.dataset.part}.svg`, assets).href;
}
for (let index = 0; index < 12; index++) {
  const angle = index * 2.399963, reach = 62 + index % 4 * 9;
  const x = Math.cos(angle) * reach;
  const fragment = document.createElement('span');
  fragment.className = 'fragment';
  for (const [name, value] of Object.entries({
    sx: Math.cos(angle) * 18 + 'px', sy: Math.sin(angle) * 9 + 'px',
    mx: x + 'px', peak: -24 - index * 11 % 18 + 'px',
    dx: x * 1.05 + 'px', dy: 28 + index * 7 % 24 + 'px',
    turn: (index % 2 ? -1 : 1) * 110 + 'deg', rotation: (index % 2 ? -1 : 1) * (240 + index * 13) + 'deg',
    flip: 300 + index * 29 + 'deg', width: 3 + index % 2 + 'px', height: 4 + index % 3 + 'px',
    delay: index % 3 * 10 + 'ms', duration: 520 + index % 3 * 50 + 'ms'
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

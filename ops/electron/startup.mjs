const query = new URLSearchParams(location.search);
const assets = query.get('assets');
if (assets) for (const image of document.querySelectorAll('.mark img')) {
  image.src = new URL(`${image.dataset.theme}/media/launch_${image.dataset.part}.svg`, assets).href;
}
for (const [x, y, rotation] of [[-54, -35, -50], [-15, -57, 20], [42, -44, 70], [58, 12, 110], [29, 51, 150], [-43, 40, 200]]) {
  const fragment = document.createElement('span');
  fragment.className = 'fragment';
  for (const [name, value] of Object.entries({ sx: x * .45 + 'px', sy: y * .45 + 'px', dx: x + 'px', dy: y + 'px', rotation: rotation + 'deg' })) {
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

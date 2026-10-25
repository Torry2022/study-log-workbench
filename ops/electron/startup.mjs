const query = new URLSearchParams(location.search);
const assets = query.get('assets');
if (assets) for (const image of document.querySelectorAll('.mark img')) {
  image.src = new URL(`${image.dataset.theme}/media/launch_${image.dataset.part}.svg`, assets).href;
}
const message = document.getElementById('message');
message.textContent = query.get('message') || '正在准备工作台…';
window.startup.onMessage(text => { message.textContent = text; });
document.querySelector('.close').addEventListener('click', () => window.startup.close());

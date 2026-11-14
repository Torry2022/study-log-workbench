const form = document.querySelector('form'), notice = document.querySelector('#notice'), submit = form.querySelector('[type=submit]');
const $ = selector => document.querySelector(selector);
let localReady = false, directoryKind = '', firstRun = false, step = 'normal', busy = false;
for (const [index, choice] of [...document.querySelectorAll('.choice')].entries()) {
  const icon = document.createElement('span'); icon.className = 'choice-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = index === 0 ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="8" rx="2"/><rect x="4" y="13" width="16" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></svg>';
  choice.insertBefore(icon, choice.querySelector('span'));
}
const pending = document.createElement('div'); pending.id = 'pending'; pending.hidden = true;
pending.innerHTML = '<p>准备好工作台地址和访问密码后，即可在这里查看和编辑记录。</p><button class="button primary" type="button" id="reconnect">连接工作台</button> <button class="button secondary" type="button" id="local-settings">本机设置</button>';
const localSettings = document.createElement('div'); localSettings.id = 'local-settings-panel'; localSettings.hidden = true;
localSettings.innerHTML = '<label>外观<select id="local-theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>';
$('.fields').prepend(pending, localSettings);
const defer = document.createElement('button'); defer.type = 'button'; defer.id = 'defer'; defer.className = 'button secondary'; defer.textContent = '稍后连接';
$('.actions').prepend(defer);
const probeActions = document.createElement('div'); probeActions.className = 'probe-actions'; probeActions.innerHTML = '<button class="button secondary" type="button" id="read-models">读取模型</button><button class="button secondary" type="button" id="test-model">尝试生成</button><datalist id="available-models"></datalist>';
$('#ai').append(probeActions); form.elements.model.setAttribute('list', 'available-models');
function directory(root, kind) {
  directoryKind = kind; localReady = kind === 'new' || kind === 'existing';
  $('#root').value = root; $('#root').title = root;
  $('#directory-state').textContent = kind === 'new' ? '将在此处保存学习记录' : kind === 'existing' ? '可打开已有学习记录' : '';
  render();
}
window.connection.notice(message => notice.textContent = message);
function render() {
  document.body.dataset.step = firstRun ? step : 'normal';
  const remote = form.elements.mode.value === 'remote', modeStep = firstRun && step === 'mode', pendingStep = step === 'pending', settingsStep = step === 'local-settings';
  const aiStep = firstRun && step === 'ai', localVisible = !modeStep && !aiStep && !pendingStep && !settingsStep && !remote, remoteVisible = !modeStep && !aiStep && !pendingStep && !settingsStep && remote;
  $('#modes').hidden = firstRun && !modeStep;
  pending.hidden = !pendingStep; localSettings.hidden = !settingsStep;
  $('#local').hidden = !localVisible; $('#remote').hidden = !remoteVisible; $('#ai').hidden = !aiStep;
  $('#endpoint-field').hidden = form.elements.provider.value !== 'custom';
  $('#read-models').hidden = form.elements.provider.value !== 'deepseek';
  $('#key-help').textContent = form.elements.provider.value === 'deepseek' ? '在 DeepSeek 开放平台的 API keys 页面创建，再复制到这里。' : '从所使用的模型服务处获取。';
  form.elements.origin.required = remoteVisible; form.elements.password.required = remoteVisible;
  $('#back').hidden = !firstRun || modeStep || pendingStep; $('#cancel').hidden = firstRun && !modeStep; $('#skip').hidden = !aiStep;
  defer.hidden = !firstRun || !remoteVisible; submit.hidden = modeStep || pendingStep || settingsStep;
  $('#footer-hint').hidden = modeStep || aiStep || pendingStep || settingsStep;
  $('#heading').textContent = modeStep ? '选择使用方式' : pendingStep ? '连接你的工作台' : settingsStep ? '本机设置' : aiStep ? '让 AI 帮你整理记录' : remote ? '连接工作台' : firstRun ? '把记录存在哪里？' : '使用方式';
  $('#introduction').textContent = modeStep ? '选择一种方式开始使用。' : pendingStep || settingsStep ? '' : aiStep ? '整理学习材料，或从自己的记录中查找答案。你也可以稍后在设置中开启。' : remote ? '连接后，就能在这台设备上继续查看和编辑记录。' : firstRun ? '选一个方便找到的文件夹，保存日志、随记和图片。' : '在这台电脑记录学习，或连接已部署的服务器。';
  submit.disabled = busy || (localVisible && !localReady);
  for (const field of $('#ai').querySelectorAll('input, select, button')) field.disabled = busy;
  $('#back').disabled = busy; $('#skip').disabled = busy; defer.disabled = busy;
  submit.textContent = modeStep ? '继续' : aiStep ? '保存并开始使用' : remote ? '连接服务器' : firstRun && directoryKind === 'new' ? '继续' : '打开本地工作台';
}
form.addEventListener('change', render);
for (const choice of document.querySelectorAll('#modes input')) choice.addEventListener('click', () => { if (firstRun && step === 'mode') { step = choice.value; notice.textContent = ''; render(); } });
$('#cancel').onclick = () => window.connection.cancel();
$('#back').onclick = () => { step = step === 'ai' ? 'local' : step === 'local-settings' ? 'pending' : 'mode'; notice.textContent = ''; render(); };
$('#reconnect').onclick = () => { step = 'remote'; form.elements.mode.value = 'remote'; render(); };
$('#local-settings').onclick = () => { step = 'local-settings'; render(); };
$('#local-theme').onchange = async event => { try { await window.connection.theme(event.target.value); notice.textContent = '外观已保存。'; } catch { notice.textContent = '无法保存外观，请重试。'; } };
defer.onclick = async () => { try { await window.connection.defer(); step = 'pending'; form.elements.password.value = ''; notice.textContent = ''; render(); } catch { notice.textContent = '暂时无法保存，请重试。'; } };
async function connect(ai) {
  busy = true; render(); notice.textContent = '';
  try {
    const value = { mode: form.elements.mode.value, origin: form.elements.origin.value.trim(), password: form.elements.password.value, localHttp: form.elements.localHttp.checked };
    if (ai) value.ai = { provider: form.elements.provider.value, endpoint: form.elements.endpoint.value, key: form.elements.key.value, model: form.elements.model.value };
    const result = await window.connection.select(value);
    if (result.error) notice.textContent = result.error;
  } catch { notice.textContent = '连接未完成，请重试。'; }
  finally { busy = false; render(); }
}
$('#skip').onclick = () => void connect(false);
async function probe(action) {
  busy = true; render(); notice.textContent = '正在检查…';
  try {
    const endpoint = form.elements.provider.value === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : form.elements.endpoint.value.trim();
    const result = await window.connection.probe({ action, endpoint, model: form.elements.model.value.trim(), key: form.elements.key.value });
    if (result.cancelled) notice.textContent = '';
    else if (action === 'models') { $('#available-models').replaceChildren(...result.models.map(value => { const option = document.createElement('option'); option.value = value; return option; })); notice.textContent = `已读取 ${result.models.length} 个模型，也可以手动填写。`; }
    else notice.textContent = '生成检查通过。';
  } catch (error) { notice.textContent = String(error?.message || '').replace(/^Error invoking remote method '[^']+': Error: /, '') || '检查未完成，请重试。'; }
  finally { busy = false; render(); }
}
$('#read-models').onclick = () => void probe('models'); $('#test-model').onclick = () => void probe('test');
$('#ai').addEventListener('input', () => { notice.textContent = ''; $('#available-models').replaceChildren(); });
try {
  const saved = await window.connection.read(); firstRun = saved.firstRun; step = saved.pending ? 'pending' : firstRun ? 'mode' : 'normal';
  $('#local-theme').value = saved.themePreference;
  form.elements.mode.value = saved.mode; form.elements.origin.value = saved.origin; form.elements.localHttp.checked = saved.localHttp;
  directory(saved.root, saved.kind); if (firstRun) { localReady = false; $('#root').value = ''; $('#directory-state').textContent = ''; }
  $('.logo-light').src = saved.logos.light; $('.logo-dark').src = saved.logos.dark;
  if (saved.error && !firstRun) notice.textContent = saved.error; render();
} catch { notice.textContent = '无法读取使用设置，请关闭后重试。'; }
form.onsubmit = event => {
  event.preventDefault(); if (busy) return;
  if (firstRun && step === 'mode') { step = form.elements.mode.value; notice.textContent = ''; render(); return; }
  if (firstRun && step === 'local' && directoryKind === 'new') { step = 'ai'; notice.textContent = ''; render(); return; }
  void connect(firstRun && step === 'ai');
};
$('#choose-directory').onclick = async () => {
  const button = $('#choose-directory'); button.disabled = true; notice.textContent = '';
  try { const result = await window.connection.pickDirectory(); if (result.error) notice.textContent = result.error; else if (!result.canceled) directory(result.root, result.kind); }
  catch { notice.textContent = '无法打开文件夹选择窗口，请重试。'; } finally { button.disabled = false; }
};

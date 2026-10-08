const form = document.querySelector('form');
const notice = document.querySelector('#notice');
const fields = form.elements;
const button = form.querySelector('[type=submit]');
let original, saving = false;
const update = () => {
  button.disabled = saving || !original || !(fields.apiUrl.value.trim() !== original.apiUrl || fields.model.value.trim() !== original.model || fields.apiKey.value || fields.clearKey.checked && original.hasKey);
};
form.oninput = update;
form.onchange = update;
document.querySelector('#cancel').onclick = () => window.close();
try {
  const config = await window.modelSettings.read();
  fields.apiUrl.value = config.apiUrl;
  fields.model.value = config.model;
  fields.apiKey.placeholder = config.hasKey ? '已保存，留空则保留原 Key' : '填写 API Key';
  fields.clearKey.disabled = !config.hasKey;
  original = config; update();
} catch { notice.textContent = '无法读取模型设置，请关闭后重试。'; }
form.onsubmit = async event => {
  event.preventDefault();
  if (button.disabled) return;
  if (fields.apiUrl.value && !/^https?:\/\//i.test(fields.apiUrl.value.trim())) { notice.textContent = '接口地址应以 https:// 或 http:// 开头。'; return; }
  saving = true; update();
  try {
    await window.modelSettings.save({apiUrl:fields.apiUrl.value.trim(),model:fields.model.value.trim(),apiKey:fields.apiKey.value,clearKey:fields.clearKey.checked});
  } catch { notice.textContent = '未能保存设置，请检查填写内容后重试。'; saving = false; update(); }
};

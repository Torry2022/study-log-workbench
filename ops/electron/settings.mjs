const form = document.querySelector('form');
const notice = document.querySelector('#notice');
const fields = form.elements;
const button = form.querySelector('[type=submit]');
let original, saving = false, pending = null;
const update = () => {
  for (const field of [fields.apiUrl, fields.model, fields.apiKey]) field.disabled = saving || !original;
  fields.clearKey.disabled = saving || !original?.hasKey;
  button.disabled = saving || !original || !(fields.apiUrl.value.trim() || fields.model.value.trim() !== original.model || fields.apiKey.value || fields.clearKey.checked && original.hasKey);
};
form.oninput = () => { pending = null; update(); };
form.onchange = () => { pending = null; update(); };
document.querySelector('#cancel').onclick = () => window.modelSettings.cancel();
update();
document.querySelector('#reload').onclick = async () => {
  if (saving) return;
  try { const latest = await window.modelSettings.read(); notice.textContent = `当前已保存模型：${latest.model || '未设置'}。已保留填写内容，可继续编辑并保存。`; original = latest; pending = null; update(); }
  catch { notice.textContent = '无法读取最新设置，填写内容仍保留。'; }
};
try {
  const config = await window.modelSettings.read();
  fields.apiUrl.value = '';
  fields.apiUrl.placeholder = config.hasEndpoint ? `${config.endpointDisplay || '已设置'}（留空保留原地址）` : 'https://api.example.com/v1/chat/completions';
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
    pending ??= {apiUrl:fields.apiUrl.value.trim(),model:fields.model.value.trim(),apiKey:fields.apiKey.value,clearKey:fields.clearKey.checked,expectedRevision:original.revision,expectedInstanceId:original.instanceId,operationId:crypto.randomUUID()};
    original = await window.modelSettings.save(pending); pending = null;
    fields.apiUrl.value = ''; fields.apiKey.value = ''; fields.clearKey.checked = false;
    fields.apiUrl.placeholder = original.hasEndpoint ? `${original.endpointDisplay || '已设置'}（留空保留原地址）` : 'https://api.example.com/v1/chat/completions';
    fields.apiKey.placeholder = original.hasKey ? '已保存，留空则保留原 Key' : '填写 API Key';
    fields.clearKey.disabled = !original.hasKey; notice.textContent = '设置已保存，将用于新开始的任务。'; saving = false; update();
  } catch (error) { notice.textContent = String(error?.message || '').includes('另一处更新') ? '设置已在另一处更新，请核对最新设置。填写内容仍保留。' : '暂时无法确认保存结果，填写内容仍保留。请核对最新设置或重试。'; document.querySelector('#reload').hidden = false; saving = false; update(); }
};

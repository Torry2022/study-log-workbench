const element = id => document.getElementById(id);
const incoming = location.hash.slice(1);
if (incoming) { sessionStorage.setItem("launcher-token", incoming); history.replaceState(null, "", "/"); }
const token = sessionStorage.getItem("launcher-token") || "";
let clientId = crypto.randomUUID();
const value = id => element(id).value.trim();
let busy = false, connected = false, state = {}, candidate = null, revision = 0, timer, runAction = "", modelConfig = null, pendingModelSave = null;
function feedback(scope, message = "", error = false) {
  const node = element(scope); node.textContent = message; node.hidden = !message; node.classList.toggle("error", error);
}
async function api(action, input = {}) {
  const response = await fetch(`/api/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function render() {
  const stopped = state.state === "stopped", running = state.state === "running";
  const ready = candidate?.kind === "existing" && candidate.root === state.root;
  const locked = busy || !connected;
  element("state").textContent = !connected ? "未连接" : ({ stopped: "未运行", starting: "正在启动", running: "正在运行", stopping: "正在停止", failed: "运行异常" })[state.state];
  element("state").dataset.running = String(running);
  element("current").textContent = !value("root") ? "请选择保存位置。" : !candidate ? "正在检查目录…" : candidate.kind === "new" ? "此文件夹可以保存学习记录。设置访问密码后即可开始使用。" : candidate.kind === "existing" ? ready ? "保存位置已就绪。" : "已找到学习记录，可直接打开，无需重新设置密码。" : candidate.message;
  element("current").classList.toggle("error", candidate?.kind === "invalid");
  element("create-fields").hidden = candidate?.kind !== "new";
  element("select").hidden = candidate?.kind !== "existing" || ready;
  element("create").disabled = locked || !stopped || candidate?.kind !== "new" || element("password").value.trim().length < 12;
  element("select").disabled = locked || !stopped || candidate?.kind !== "existing" || ready;
  element("root").disabled = locked || !stopped;
  element("password").disabled = locked || !stopped;
  element("start").textContent = runAction === "start" ? "正在启动…" : runAction === "stop" ? "正在停止…" : running ? "停止工作台" : "启动工作台";
  element("start").disabled = locked || !(running || stopped && ready);
  element("start").classList.toggle("primary", !running);
  element("open").hidden = !running || !state.url;
  if (state.url) element("open").href = state.url;
  element("run-help").textContent = running ? `访问地址：${state.url}` : ready ? "保存位置已准备好，可以启动工作台。" : "准备好保存位置后，即可启动工作台。";
  const canConfigure = ready && modelConfig && ["stopped", "running"].includes(state.state);
  const provider = value("provider"), removeKey = element("clearKey").checked;
  element("configure").disabled = locked || !canConfigure || !element("reload-settings").hidden;
  element("reload-settings").disabled = locked || !canConfigure;
  element("model-help").hidden = Boolean(canConfigure);
  element("endpoint-field").hidden = provider !== "custom";
  element("key-help").hidden = provider !== "deepseek";
  element("clear-key-field").hidden = !modelConfig?.hasKey;
  for (const id of ["provider", "apiUrl", "model", "apiKey", "clearKey", "lightModel"]) element(id).disabled = locked || !canConfigure;
  element("apiKey").disabled ||= removeKey;
  element("backup").disabled = locked || !ready || !["stopped", "running"].includes(state.state);
  element("verify").disabled = locked || !value("archive");
  element("restore").disabled = locked || !stopped || !value("archive") || !value("restoreRoot");
  for (const button of document.querySelectorAll("[data-pick]")) button.disabled = locked || button.dataset.for === "root" && !stopped;
  for (const id of ["archive", "restoreRoot"]) element(id).disabled = locked;
}
async function inspect() {
  const request = ++revision, root = value("root"); candidate = null; render();
  if (!root) return;
  try { const result = await api("inspect", { root }); if (request === revision) candidate = result; }
  catch (error) { if (request === revision) candidate = { kind: "invalid", message: error.message }; }
  if (request === revision) render();
}
async function status() {
  const response = await fetch("/api/status", { headers: { Authorization: `Bearer ${token}`, "X-Launcher-Client": clientId } });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  state = result; connected = true; feedback("notice");
  if (state.issue) feedback("run-notice", state.issue, true);
  render();
}
function showConfiguration(config, preserveDraft = false) {
  modelConfig = config;
  pendingModelSave = null;
  element("reload-settings").hidden = true;
  const keep = element("provider").options[0];
  keep.disabled = !config.hasEndpoint;
  keep.textContent = config.endpointDisplay ? `沿用当前服务（${config.endpointDisplay}）` : "沿用当前服务";
  if (!preserveDraft) {
    element("provider").value = config.hasEndpoint ? "keep" : "deepseek";
    element("apiUrl").value = "";
    element("apiKey").value = "";
    element("clearKey").checked = false;
    element("model").value = config.model;
    element("lightModel").value = config.lightModel || "";
  }
  if (!config.hasKey) element("clearKey").checked = false;
  element("keyStatus").textContent = config.hasKey ? "API Key 已设置" : "API Key 尚未设置";
  render();
}
async function configuration() { showConfiguration(await api("configuration")); }
async function run(scope, work, completed = "") {
  if (busy) return;
  const trigger = document.activeElement?.tagName === "BUTTON" ? document.activeElement : null;
  const label = trigger?.textContent;
  if (trigger) trigger.textContent = ({ create: "正在创建…", select: "正在打开…", configure: "正在保存…", backup: "正在备份…", verify: "正在校验…", restore: "正在恢复…" })[trigger.id] || "请选择…";
  busy = true; feedback(scope); render();
  try { const result = await work(); await status(); if (result !== false && !state.issue) feedback(scope, completed); }
  catch (error) {
    try { await status(); } catch { connected = false; }
    feedback(scope, error.message || "无法连接本地工作台，请重新打开。", true);
  }
  finally { if (trigger) trigger.textContent = label; busy = false; render(); }
}
element("root").oninput = () => { ++revision; candidate = null; clearTimeout(timer); feedback("directory-notice"); render(); timer = setTimeout(inspect, 250); };
for (const id of ["password", "archive", "restoreRoot"]) element(id).oninput = render;
element("create").onclick = () => run("directory-notice", async () => { await api("select", { root: value("root"), create: true, password: element("password").value }); element("password").value = ""; await status(); await inspect(); await configuration(); });
element("select").onclick = () => run("directory-notice", async () => { await api("select", { root: value("root") }); await status(); await inspect(); await configuration(); });
element("start").onclick = async () => {
  if (busy || element("start").disabled) return;
  runAction = state.state === "running" ? "stop" : "start";
  try { await run("run-notice", () => api(runAction)); }
  finally { runAction = ""; render(); }
};
for (const id of ["provider", "apiUrl", "model", "apiKey", "clearKey", "lightModel"]) {
  element(id).oninput = () => { pendingModelSave = null; render(); };
}
element("reload-settings").onclick = () => run("model-notice", async () => {
  const latest = await api("configuration");
  if (latest.instanceId !== modelConfig.instanceId) throw new Error("工作台身份已变化，请重新打开学习记录。");
  const keyNeedsReentry = value("provider") === "keep" && Boolean(element("apiKey").value);
  if (keyNeedsReentry) element("apiKey").value = "";
  showConfiguration(latest, true);
  if (keyNeedsReentry) {
    feedback("model-notice", "已读取最新设置。请确认当前服务，并重新填写对应的 API Key。");
    return false;
  }
}, "已读取最新设置，请核对当前填写的内容。");
element("configure").onclick = () => run("model-notice", async () => {
  const provider = value("provider"), apiKey = element("apiKey").value, clearKey = element("clearKey").checked;
  if (provider === "custom" && !value("apiUrl")) {
    throw new Error("请填写服务商提供的完整接口地址。");
  }
  if (provider !== "keep" && modelConfig.hasKey && !clearKey && !apiKey) {
    throw new Error("更换服务时，请填写对应的 API Key，或选择移除已存密钥。");
  }
  const apiUrl = provider === "deepseek" ? "https://api.deepseek.com/chat/completions" : provider === "custom" ? value("apiUrl") : "";
  const operationId = pendingModelSave || crypto.randomUUID();
  pendingModelSave = operationId;
  const input = { apiUrl, model: value("model"), lightModel: value("lightModel"), apiKey, clearKey,
    expectedRevision: modelConfig.revision, expectedInstanceId: modelConfig.instanceId, operationId };
  let saved;
  try { saved = await api("configure", input); }
  catch (error) {
    const latest = await api("configuration").catch(() => null);
    if (!latest) throw new Error("暂时无法确认保存结果。连接恢复后可重试。");
    if (latest.instanceId !== modelConfig.instanceId) throw new Error("工作台身份已变化，请重新打开学习记录。");
    if (latest.operationId === operationId) saved = latest;
    else if (latest.revision !== modelConfig.revision) {
      element("reload-settings").hidden = false;
      throw new Error("AI 设置已更新，请核对最新设置后保存。");
    } else throw error;
  }
  showConfiguration(saved);
}, "设置已保存，将用于新开始的任务。");
for (const button of document.querySelectorAll("[data-pick]")) button.onclick = () => run(button.dataset.for === "root" ? "directory-notice" : "backup-notice", async () => { const selected = await api("pick", { mode: button.dataset.pick }); if (!selected.path) return false; element(button.dataset.for).value = selected.path; if (button.dataset.for === "root") await inspect(); });
element("backup").onclick = () => run("backup-notice", async () => { const selected = await api("pick", { mode: "save" }); if (!selected.path) return false; await api("backup", { archive: selected.path }); element("archive").value = selected.path; }, "备份已保存，工作台已停止。");
element("verify").onclick = () => run("backup-notice", () => api("verify", { archive: value("archive") }), "备份校验通过。");
element("restore").onclick = () => run("backup-notice", async () => { await api("restore", { archive: value("archive"), root: value("restoreRoot") }); element("root").value = value("restoreRoot"); await status(); await inspect(); await configuration(); }, "已恢复到新目录，原有学习记录保持不变。");
status().then(async () => { if (state.root) { element("root").value = state.root; await inspect(); await configuration(); } }).catch(error => { feedback("notice", error.message, true); render(); });
setInterval(() => { if (!busy) void status().catch(() => { connected = false; feedback("notice", "本地工作台已断开，请通过启动文件重新打开。", true); render(); }); }, 2500);

// Closing a stopped launcher page releases its manager; reload and other tabs
// retain it. Running services are stopped only through the explicit toggle.
addEventListener("pagehide", () => {
  void fetch("/api/leave", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ clientId }) }).catch(() => {});
});
addEventListener("pageshow", event => { if (event.persisted) { clientId = crypto.randomUUID(); void status().catch(() => { connected = false; render(); }); } });

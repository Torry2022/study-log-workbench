const element = id => document.getElementById(id);
const incoming = location.hash.slice(1);
if (incoming) { sessionStorage.setItem("launcher-token", incoming); history.replaceState(null, "", "/"); }
const token = sessionStorage.getItem("launcher-token") || "";
let clientId = crypto.randomUUID();
const value = id => element(id).value.trim();
let busy = false, connected = false, state = {}, candidate = null, revision = 0, timer, runAction = "";
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
  element("current").textContent = !value("root") ? "请选择资料目录。" : !candidate ? "正在检查目录…" : candidate.kind === "new" ? "此目录可用于新建实例。设置访问密码后创建，资料将保存在这里。" : candidate.kind === "existing" ? ready ? "资料目录已就绪。" : "已找到工作台实例，可直接打开，无需重新设置密码。" : candidate.message;
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
  element("run-help").textContent = running ? `访问地址：${state.url}` : ready ? "资料已准备好，可以启动工作台。" : "创建或打开资料目录后，即可启动。";
  element("configure").disabled = locked || !stopped || !ready;
  element("model-help").hidden = ready && stopped;
  element("model-help").textContent = !stopped ? "停止工作台后可修改模型配置。" : "请先创建或打开资料目录。";
  for (const id of ["apiUrl", "model", "apiKey", "clearKey"]) element(id).disabled = locked || !stopped || !ready;
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
async function configuration() { const config = await api("configuration"); element("apiUrl").value = config.apiUrl; element("model").value = config.model; element("keyStatus").textContent = config.hasKey ? "已保存 API Key" : "未配置 API Key"; }
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
element("configure").onclick = () => run("model-notice", async () => { await api("configure", { apiUrl: value("apiUrl"), model: value("model"), apiKey: element("apiKey").value, clearKey: element("clearKey").checked }); element("apiKey").value = ""; element("clearKey").checked = false; await configuration(); }, "模型配置已保存。");
for (const button of document.querySelectorAll("[data-pick]")) button.onclick = () => run(button.dataset.for === "root" ? "directory-notice" : "backup-notice", async () => { const selected = await api("pick", { mode: button.dataset.pick }); if (!selected.path) return false; element(button.dataset.for).value = selected.path; if (button.dataset.for === "root") await inspect(); });
element("backup").onclick = () => run("backup-notice", async () => { const selected = await api("pick", { mode: "save" }); if (!selected.path) return false; await api("backup", { archive: selected.path }); element("archive").value = selected.path; }, "备份已保存，工作台已停止。");
element("verify").onclick = () => run("backup-notice", () => api("verify", { archive: value("archive") }), "备份校验通过。");
element("restore").onclick = () => run("backup-notice", async () => { await api("restore", { archive: value("archive"), root: value("restoreRoot") }); element("root").value = value("restoreRoot"); await status(); await inspect(); await configuration(); }, "已恢复到新目录，原资料保持不变。");
status().then(async () => { if (state.root) { element("root").value = state.root; await inspect(); await configuration(); } }).catch(error => { feedback("notice", error.message, true); render(); });
setInterval(() => { if (!busy) void status().catch(() => { connected = false; feedback("notice", "本地工作台已断开，请通过启动文件重新打开。", true); render(); }); }, 2500);

// Closing a stopped launcher page releases its manager; reload and other tabs
// retain it. Running services are stopped only through the explicit toggle.
addEventListener("pagehide", () => {
  void fetch("/api/leave", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ clientId }) }).catch(() => {});
});
addEventListener("pageshow", event => { if (event.persisted) { clientId = crypto.randomUUID(); void status().catch(() => { connected = false; render(); }); } });

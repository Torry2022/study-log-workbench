const element = id => document.getElementById(id);
const incoming = location.hash.slice(1);
if (incoming) { sessionStorage.setItem("launcher-token", incoming); history.replaceState(null, "", "/"); }
const token = sessionStorage.getItem("launcher-token") || "";
let busy = false, exited = false;
const value = id => element(id).value;
function notice(message, error = false) { element("notice").textContent = message; element("notice").classList.toggle("error", error); }
async function api(action, input = {}) {
  const response = await fetch(`/api/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
async function status() {
  if (exited) return;
  const response = await fetch("/api/status", { headers: { Authorization: `Bearer ${token}` } });
  const state = await response.json(); if (!response.ok) throw new Error(state.error);
  element("state").textContent = ({ stopped: "已停止", starting: "正在启动", running: "正在运行", stopping: "等待操作完成后停止", failed: "需要检查" })[state.state];
  element("current").textContent = state.root ? `当前资料：${state.root}` : "新目录请设置密码后点击“新建实例”；已有资料请点击“打开已有实例”。";
  if (!value("root") && state.root) element("root").value = state.root;
  element("open").hidden = !state.url; if (state.url) element("open").href = state.url;
  if (state.issue) notice(state.issue, true);
  return state;
}
async function configuration() { const config = await api("configuration"); element("apiUrl").value = config.apiUrl; element("model").value = config.model; element("keyStatus").textContent = config.hasKey ? "已保存 API Key" : "未配置 API Key"; }
async function run(pending, completed, work) {
  if (busy) return; busy = true;
  document.querySelectorAll("button").forEach(button => button.disabled = true);
  notice(pending);
  try { const result = await work(); if (!exited) { const current = await status(); if (!current.issue) notice(result === false ? "已取消" : completed); } }
  catch (error) { notice(error.message || "无法连接启动入口，请重新打开", true); }
  finally { busy = false; document.querySelectorAll("button").forEach(button => button.disabled = exited); }
}
element("create").onclick = () => run("正在创建…", "已创建资料目录", async () => { await api("select", { root: value("root"), create: true, password: value("password") }); element("password").value = ""; await configuration(); });
element("select").onclick = () => run("正在打开…", "已打开资料目录", async () => { await api("select", { root: value("root") }); await configuration(); });
element("start").onclick = () => run("正在启动…", "已启动", async () => { const result = await api("start"); element("open").href = result.url; element("open").hidden = false; });
element("stop").onclick = () => run("正在停止…", "已停止", () => api("stop"));
element("exit").onclick = () => run("正在退出…", "已退出", async () => { const result = await api("exit"); exited = true; element("open").hidden = true; element("state").textContent = "已退出"; notice(result.issue || "服务已正常退出，可以关闭此页面。", Boolean(result.issue)); });
element("configure").onclick = () => run("正在保存…", "已保存模型配置", async () => { await api("configure", { apiUrl: value("apiUrl"), model: value("model"), apiKey: value("apiKey"), clearKey: element("clearKey").checked }); element("apiKey").value = ""; element("clearKey").checked = false; await configuration(); });
for (const button of document.querySelectorAll("[data-pick]")) button.onclick = () => run("请选择位置…", "已选择位置", async () => { const selected = await api("pick", { mode: button.dataset.pick }); if (!selected.path) return false; element(button.dataset.for).value = selected.path; });
element("backup").onclick = () => run("请选择备份位置…", "备份已保存", async () => { const selected = await api("pick", { mode: "save" }); if (!selected.path) return false; notice("正在备份…"); await api("backup", { archive: selected.path }); element("archive").value = selected.path; });
element("verify").onclick = () => run("正在校验…", "备份校验通过", () => api("verify", { archive: value("archive") }));
element("restore").onclick = () => run("正在恢复…", "已恢复到新目录", async () => { await api("restore", { archive: value("archive"), root: value("restoreRoot") }); element("root").value = value("restoreRoot"); await configuration(); });
status().then(state => { if (state?.root) return configuration(); }).catch(error => notice(error.message, true));
setInterval(() => { if (!exited) void status().catch(() => { if (!busy) notice("启动入口已断开，请重新打开。若上次运行未正常结束，请先按维护说明检查。", true); }); }, 2500);

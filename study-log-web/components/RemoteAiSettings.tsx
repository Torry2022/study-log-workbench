"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError, requestJson } from "@/lib/client-http";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import { AiSettingsPreview } from "./AiSettingsPreview";

export type RemoteAiSummary = { instanceId: string; revision: number; operationId: string | null; provider: "deepseek" | "custom"; endpointDisplay: string; hasEndpoint: boolean; model: string; hasKey: boolean; lightModel: string; contextWindowTokens: string; thinking: string; toolCallingVerified: boolean; statusVerificationEnabled: boolean };
type Action = "save" | "models" | "test" | "preview" | "restore";
type Preview = { instanceId: string; previewId: string; revision: number; provider: string; endpointDisplay: string; model: string; hasKey: boolean };

function PasswordDialog({ action, onCancel, onConfirm }: { action: Action; onCancel: () => void; onConfirm: (password: string) => void }) {
  const [password, setPassword] = useState(""); const input = useRef<HTMLInputElement>(null);
  const { backdropRef, requestExit } = useDialogExit(cancel);
  function cancel() { requestExit(onCancel); }
  useEffect(() => { const unlock = lockBodyScroll(); requestAnimationFrame(() => input.current?.focus()); return unlock; }, []);
  return createPortal(<div ref={backdropRef} className="confirmation-backdrop" onMouseDown={() => requestExit(onCancel)}><form className="confirmation-dialog settings-password" role="dialog" aria-modal="true" aria-labelledby="settings-password-title" onMouseDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); if (password) { const value = password; setPassword(""); requestExit(() => onConfirm(value)); } }}>
    <h3 id="settings-password-title">确认工作台密码</h3><p>{action === "test" ? "生成检查会发送一条简短请求，并可能产生模型费用。" : "请输入工作台访问密码，确认此次操作。"}</p>
    <label>访问密码<input ref={input} type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <div className="settings-actions"><button className="button secondary" type="button" onClick={() => requestExit(onCancel)}>取消</button><button className="button primary" type="submit" disabled={!password}>确认</button></div>
  </form></div>, document.body);
}

export function RemoteAiSettings({ initial, onDirty }: { initial: RemoteAiSummary; onDirty: (value: boolean) => void }) {
  const [saved, setSaved] = useState(initial), [provider, setProvider] = useState<"deepseek" | "custom">(!initial.hasEndpoint ? "deepseek" : initial.provider);
  const [endpoint, setEndpoint] = useState(""), [model, setModel] = useState(initial.model), [lightModel, setLightModel] = useState(initial.lightModel || "");
  const [key, setKey] = useState(""), [removeKey, setRemoveKey] = useState(false), [requiresEndpoint, setRequiresEndpoint] = useState(false);
  const [capacity, setCapacity] = useState(initial.contextWindowTokens || ""), [capacityTouched, setCapacityTouched] = useState(false), [targetChanged, setTargetChanged] = useState(false);
  const [thinking, setThinking] = useState(initial.thinking || ""), [thinkingTouched, setThinkingTouched] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [confirm, setConfirm] = useState<Action | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const [unresolvedReceipt, setUnresolvedReceipt] = useState(false);
  const [models, setModels] = useState<string[]>([]), [checked, setChecked] = useState(false), [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState<{ action: "save" | "restore"; payload: Record<string, unknown> } | null>(null);
  const live = useRef(true), generation = useRef(0), request = useRef<AbortController | null>(null);
  const receiptKey = `study-log:settings-operation:${initial.instanceId}`;
  useEffect(() => {
    live.current = true;
    try { if (sessionStorage.getItem(receiptKey)) { setNeedsReview(true); setNotice("上次保存的结果尚待核对，请先读取最新设置。"); } } catch { /* Storage is optional. */ }
    return () => { live.current = false; generation.current++; request.current?.abort(); };
  }, [receiptKey]);
  const changed = () => { generation.current++; onDirty(true); setNotice(""); setPending(null); setModels([]); setChecked(false); setPreview(null); };
  const targetEdited = () => { if (!targetChanged) { setCapacity(""); setCapacityTouched(false); setTargetChanged(true); } changed(); };
  function receipt(value: { action: "save" | "restore"; operationId: unknown; expectedRevision: unknown } | null) {
    try { if (value) sessionStorage.setItem(receiptKey, JSON.stringify(value)); else sessionStorage.removeItem(receiptKey); } catch { /* Never store private form fields. */ }
  }
  function draft() {
    const replacement = provider === "deepseek" && saved.provider !== "deepseek" ? "https://api.deepseek.com/chat/completions" : endpoint.trim();
    if (provider === "custom" && (saved.hasEndpoint && saved.provider !== "custom" || requiresEndpoint) && !replacement) throw Error("请输入完整接口地址。");
    if (!saved.hasEndpoint && !replacement && key && !removeKey) throw Error("请先填写服务地址再保存密钥。");
    if (replacement && saved.hasKey && !key && !removeKey) throw Error("更换接口地址后，请填写新密钥或移除原密钥。");
    return { expectedInstanceId: saved.instanceId, expectedRevision: saved.revision, provider, endpointAction: replacement ? "replace" : "keep", ...(replacement ? { endpoint: replacement } : {}),
      keyAction: removeKey ? "remove" : key ? "replace" : "keep", ...(!removeKey && key ? { key } : {}), model: model.trim(), lightModel: lightModel.trim(),
      ...(capacityTouched ? { contextWindowTokens: capacity.trim() } : {}), ...(thinkingTouched && provider === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(model.trim()) ? { thinking } : {}) };
  }
  function begin(action: Action) { try { if (busy) return; let hasReceipt = false; try { hasReceipt = Boolean(sessionStorage.getItem(receiptKey)); } catch { /* Storage is optional. */ } if ((hasReceipt && !pending || pending && pending.action !== action) && (action === "save" || action === "restore")) { setNotice("上次保存结果尚待核对，请先读取最新设置。"); return; } if (action !== "preview" && action !== "restore") draft(); setConfirm(action); } catch (error) { setNotice(error instanceof Error ? error.message : "请检查设置。"); } }
  async function reload() {
    if (busy) return;
    const controller = new AbortController(); request.current = controller; const turn = generation.current; setBusy(true);
    try {
      const latest = await requestJson<RemoteAiSummary>("/api/settings/ai", { signal: controller.signal, headers: { "X-Study-Log-Instance": saved.instanceId } });
      if (!live.current || turn !== generation.current) return;
      if (latest.instanceId !== saved.instanceId) throw Error();
      let previous: { operationId?: string; expectedRevision?: number } | null = null; try { previous = JSON.parse(sessionStorage.getItem(receiptKey) || "null"); } catch { /* Ignore malformed local state. */ }
      if ((pending && latest.operationId === pending.payload.operationId) || previous?.operationId && latest.operationId === previous.operationId) { receipt(null); setNeedsReview(false); setSaved(latest); setPending(null); setEndpoint(""); setKey(""); setRemoveKey(false); setRequiresEndpoint(false); onDirty(false); setNotice("已确认设置保存成功。"); return; }
      if (!pending && previous && latest.revision === previous.expectedRevision) { receipt(null); setUnresolvedReceipt(false); setNotice("上次设置尚未保存，请重新填写需要修改的内容。"); }
      else if (previous && latest.revision !== previous.expectedRevision && latest.operationId !== previous.operationId) { setUnresolvedReceipt(true); setNotice("上次保存结果无法确认，请核对当前设置。"); }
      if (latest.revision !== saved.revision) { setKey(""); setRemoveKey(false); setModels([]); setChecked(false); setPreview(null); if (provider === "custom" && !endpoint.trim()) setRequiresEndpoint(true); setPending(null); setNotice("设置已在另一处更新。请核对地址并重新填写密钥，其他填写内容仍保留。"); }
      else if (!previous) setNotice("已核对最新设置，填写内容仍保留。");
      setSaved(latest);
    } catch { if (live.current && !controller.signal.aborted) setNotice("无法读取最新设置，填写内容仍保留。"); }
    finally { if (request.current === controller) request.current = null; if (live.current) setBusy(false); }
  }
  async function execute(action: Action, password: string) {
    setConfirm(null); setBusy(true); if (action === "test" || action === "models") setChecked(false); setNotice(""); const controller = new AbortController(); request.current = controller; const turn = generation.current;
    try {
      if (action === "preview") {
        const data = await requestJson<Preview>("/api/settings/ai/deployment-preview", { method: "POST", signal: controller.signal, body: JSON.stringify({ password, expectedInstanceId: saved.instanceId }) }); if (!live.current || turn !== generation.current) return; if (data.instanceId !== saved.instanceId) throw Error("工作台身份已变化，请重新连接。"); setPreview(data); setNotice("已读取部署配置，请核对后决定是否恢复。");
      } else if (action === "restore") {
        if (!preview) throw Error("请先读取部署配置。");
        const operation = pending?.action === "restore" ? pending.payload : { mode: "restore_deployment", expectedInstanceId: saved.instanceId, expectedRevision: preview.revision, operationId: crypto.randomUUID(), previewId: preview.previewId };
        setPending({ action: "restore", payload: operation }); receipt({ action: "restore", operationId: operation.operationId, expectedRevision: operation.expectedRevision });
        const result = await requestJson<RemoteAiSummary>("/api/settings/ai", { method: "PUT", signal: controller.signal, body: JSON.stringify({ ...operation, password }) });
        if (!live.current || turn !== generation.current) return;
        if (result.instanceId !== saved.instanceId || result.operationId !== operation.operationId) { setNeedsReview(true); setNotice("暂时无法确认保存结果，请核对最新设置。"); return; }
        receipt(null); setNeedsReview(false); setSaved(result); setProvider(result.provider); setModel(result.model); setLightModel(result.lightModel || ""); setCapacity(result.contextWindowTokens || ""); setThinking(result.thinking || ""); setCapacityTouched(false); setThinkingTouched(false); setTargetChanged(false); setEndpoint(""); setKey(""); setRemoveKey(false); setPending(null); setPreview(null); onDirty(false); setNotice("设置已保存，将用于新开始的任务。");
      } else {
        const values = draft();
        if (action === "save") {
          const operation = pending?.action === "save" ? pending.payload : { ...values, operationId: crypto.randomUUID() }; setPending({ action: "save", payload: operation });
          receipt({ action: "save", operationId: operation.operationId, expectedRevision: operation.expectedRevision });
          const result = await requestJson<RemoteAiSummary>("/api/settings/ai", { method: "PUT", signal: controller.signal, body: JSON.stringify({ ...operation, password }) });
          if (!live.current || turn !== generation.current) return;
          if (result.instanceId !== saved.instanceId || result.operationId !== operation.operationId) { setNeedsReview(true); setNotice("暂时无法确认保存结果，请核对最新设置。"); return; }
          receipt(null); setNeedsReview(false); setSaved(result); setCapacity(result.contextWindowTokens || ""); setThinking(result.thinking || ""); setCapacityTouched(false); setThinkingTouched(false); setTargetChanged(false); setEndpoint(""); setKey(""); setRemoveKey(false); setRequiresEndpoint(false); setPending(null); onDirty(false); setNotice("设置已保存，将用于新开始的任务。");
        } else {
          if (values.keyAction === "remove") throw Error("请先填写密钥后再检查。");
          if (action === "test" && !values.model) throw Error("请先填写模型名称。");
          const result = await requestJson<{ instanceId: string; revision: number; models?: string[]; ok?: boolean }>(`/api/settings/ai/${action}`, { method: "POST", signal: controller.signal, body: JSON.stringify({ ...values, password }) });
          if (!live.current || turn !== generation.current) return;
          if (result.instanceId !== saved.instanceId || result.revision !== saved.revision) { setNotice("工作台或设置已变化，请重新检查。"); return; }
          if (action === "models") { setModels(result.models || []); setNotice(`已读取 ${result.models?.length || 0} 个模型，也可以手动填写。`); }
          else { setChecked(true); setNotice(""); }
        }
      }
    } catch (error) { if (live.current && !controller.signal.aborted) {
      const definitive = error instanceof ApiRequestError && [400, 401, 403, 409, 413, 429].includes(error.status);
      if (action === "save" || action === "restore") { if (definitive) { receipt(null); setPending(null); } setNeedsReview(!definitive || error.status === 409); }
      setNotice(error instanceof TypeError && (action === "save" || action === "restore") ? "暂时无法确认保存结果，填写内容仍保留。请核对最新设置。" : error instanceof Error ? error.message : "操作未完成，请重试。");
    } }
    finally { if (request.current === controller) request.current = null; if (live.current) setBusy(false); password = ""; }
  }
  return <><form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); begin("save"); }}>
    <label>服务商<select value={provider} disabled={busy} onChange={event => { setProvider(event.target.value === "deepseek" ? "deepseek" : "custom"); setEndpoint(""); setKey(""); setRemoveKey(false); targetEdited(); }}><option value="deepseek">DeepSeek</option><option value="custom">自定义服务</option></select></label>
    {provider === "custom" && <label>完整接口地址<input value={endpoint} disabled={busy} onChange={event => { setEndpoint(event.target.value); targetEdited(); }} placeholder={saved.hasEndpoint ? `${saved.endpointDisplay || "已设置"}（留空保留原地址）` : "https://example.com/v1/chat/completions"} /></label>}
    <label>API Key<input type="password" autoComplete="off" value={key} disabled={busy || removeKey} onChange={event => { setKey(event.target.value); changed(); }} placeholder={saved.hasKey ? "已设置，留空保留原密钥" : "填写服务商提供的 API Key"} /></label>
    {saved.hasKey && <label className="settings-check"><input type="checkbox" checked={removeKey} disabled={busy} onChange={event => { setRemoveKey(event.target.checked); changed(); }} />移除已保存的 Key</label>}
    <div className="settings-model-row"><label>模型<input list="settings-models" value={model} disabled={busy} onChange={event => { setModel(event.target.value); targetEdited(); }} placeholder="填写服务商提供的模型名称" /></label>{provider === "deepseek" && <button type="button" className="button secondary" disabled={busy} onClick={() => begin("models")}>读取模型</button>}</div><datalist id="settings-models">{models.map(item => <option key={item} value={item} />)}</datalist>
    <details><summary>更多选项</summary><label>轻量任务模型<input value={lightModel} disabled={busy} onChange={event => { setLightModel(event.target.value); changed(); }} placeholder="沿用上方模型" /></label><label>上下文容量<input inputMode="numeric" value={capacity} disabled={busy} onChange={event => { setCapacity(event.target.value); setCapacityTouched(true); changed(); }} placeholder="不指定；填写大于 98304 的整数" /></label><p className="settings-intro">更换服务地址或模型后，请重新确认容量。</p>{provider === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(model.trim()) && <label>推理参数<select value={thinking} disabled={busy} onChange={event => { setThinking(event.target.value); setThinkingTouched(true); changed(); }}><option value="">服务默认</option><option value="disabled">关闭思考</option><option value="low">低强度思考</option></select></label>}<p className="settings-intro">工具调用：{saved.toolCallingVerified ? "已验证" : "未验证"}；回答检查：{saved.statusVerificationEnabled ? "已验证" : "未验证"}。</p><button className="button secondary" type="button" disabled={busy} onClick={() => begin("preview")}>恢复部署配置</button></details>
    <div className="settings-action-list"><button type="button" className="button secondary" disabled={busy} onClick={() => begin("test")}>尝试生成</button>{checked && <span role="status">生成检查通过</span>}</div>
    {preview && <AiSettingsPreview preview={preview} busy={busy} onRestore={() => begin("restore")} />}
    {notice && <p role="status" className="settings-notice">{notice}</p>}
    {unresolvedReceipt && <button type="button" className="button secondary" onClick={() => { receipt(null); setPending(null); setUnresolvedReceipt(false); setNotice("请核对地址与密钥后继续编辑。"); }}>已核对，继续编辑</button>}
    <div className="settings-actions">{needsReview && <button type="button" className="button secondary" onClick={() => void reload()} disabled={busy}>核对最新设置</button>}<button type="submit" className="button primary" disabled={busy}>{busy ? "正在处理…" : "保存设置"}</button></div>
  </form>{confirm && <PasswordDialog action={confirm} onCancel={() => setConfirm(null)} onConfirm={password => void execute(confirm, password)} />}</>;
}

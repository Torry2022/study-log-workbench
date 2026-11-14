"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DesktopAiConfiguration, DesktopAiUpdate } from "@/lib/desktop-client";
import { ConfirmDialog } from "./ConfirmDialog";
import { AiSettingsPreview } from "./AiSettingsPreview";

export function LocalAiSettings({ initial, onDirty, onSaved = () => {} }: { initial: DesktopAiConfiguration; onDirty: (value: boolean) => void; onSaved?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState(initial);
  const [provider, setProvider] = useState(!initial.hasEndpoint ? "deepseek" : initial.provider);
  const [apiUrl, setApiUrl] = useState("");
  const [model, setModel] = useState(initial.model);
  const [lightModel, setLightModel] = useState(initial.lightModel || "");
  const [apiKey, setApiKey] = useState("");
  const [capacity, setCapacity] = useState(initial.contextWindowTokens || ""), [capacityTouched, setCapacityTouched] = useState(false), [targetChanged, setTargetChanged] = useState(false);
  const [thinking, setThinking] = useState(initial.thinking || ""), [thinkingTouched, setThinkingTouched] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [pending, setPending] = useState<{ action: "save"; payload: DesktopAiUpdate } | { action: "restore"; payload: { expectedInstanceId: string; expectedRevision: number; operationId: string; previewId: string } } | null>(null);
  const [requiresEndpoint, setRequiresEndpoint] = useState(false);
  const [models, setModels] = useState<string[]>([]), [checked, setChecked] = useState(false);
  const [preview, setPreview] = useState<(DesktopAiConfiguration & { previewId: string }) | null>(null), [confirmRestore, setConfirmRestore] = useState(false);
  const [unresolvedReceipt, setUnresolvedReceipt] = useState(false);
  const live = useRef(true), receiptKey = `study-log:settings-operation:${initial.instanceId}`;
  useEffect(() => { live.current = true; try { if (sessionStorage.getItem(receiptKey)) { setNeedsReview(true); setNotice("上次保存的结果尚待核对，请先读取最新设置。"); } } catch { /* Storage is optional. */ } return () => { live.current = false; }; }, [receiptKey]);
  function receipt(value: { operationId: string; expectedRevision: number } | null) { try { if (value) sessionStorage.setItem(receiptKey, JSON.stringify(value)); else sessionStorage.removeItem(receiptKey); } catch { /* Never persist form secrets. */ } }
  const changed = () => { onDirty(true); setNotice(""); setPending(null); setModels([]); setChecked(false); setPreview(null); };
  const targetEdited = () => { if (!targetChanged) { setCapacity(""); setCapacityTouched(false); setTargetChanged(true); } changed(); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !window.studyLogDesktop) return;
    try { if (!pending && sessionStorage.getItem(receiptKey)) { setNotice("上次保存结果尚待核对，请先读取最新设置。"); return; } } catch { /* Storage is optional. */ }
    const url = provider === "deepseek" && saved.provider !== "deepseek" ? "https://api.deepseek.com/chat/completions" : apiUrl.trim();
    if (provider === "custom" && (saved.hasEndpoint && saved.provider !== "custom" || requiresEndpoint) && !url) { setNotice("请输入完整接口地址。"); return; }
    if (!saved.hasEndpoint && !url && apiKey && !clearKey) { setNotice("请先填写服务地址再保存密钥。"); return; }
    if (url && saved.hasKey && !apiKey && !clearKey) { setNotice("更换接口地址后，请填写新密钥或移除原密钥。"); return; }
    if (pending && pending.action !== "save") { setNotice("上次保存结果尚待核对，请先读取最新设置。"); return; }
    const operation = pending?.payload || { apiUrl: url, model: model.trim(), lightModel: lightModel.trim(), apiKey, clearKey,
      ...(capacityTouched ? { contextWindowTokens: capacity.trim() } : {}), ...(thinkingTouched && provider === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(model.trim()) ? { thinking } : {}),
      expectedRevision: saved.revision, expectedInstanceId: saved.instanceId, operationId: crypto.randomUUID() };
    setPending({ action: "save", payload: operation }); receipt({ operationId: operation.operationId, expectedRevision: operation.expectedRevision }); setBusy(true); setNotice("");
    try {
      const result = await window.studyLogDesktop.configure(operation);
      if (!live.current) return;
      if (result.instanceId !== operation.expectedInstanceId || result.operationId !== operation.operationId || !Number.isSafeInteger(result.revision) || result.revision <= Number(operation.expectedRevision)) throw Error("保存结果待核对");
      receipt(null); setNeedsReview(false); setSaved(result); setCapacity(result.contextWindowTokens || ""); setThinking(result.thinking || ""); setCapacityTouched(false); setThinkingTouched(false); setTargetChanged(false); setApiUrl(""); setApiKey(""); setClearKey(false); setPending(null); setRequiresEndpoint(false); onDirty(false);
      setNotice("设置已保存，将用于新开始的任务。"); await onSaved();
    } catch (error) { if (live.current) { setNeedsReview(true); setNotice(String(error).includes("另一处更新") ? "设置已在另一处更新，请核对最新设置。填写内容仍保留。" : "暂时无法确认保存结果，填写内容仍保留。请核对最新设置或重试。"); } }
    finally { if (live.current) setBusy(false); }
  }
  async function reload() {
    if (busy) return; setBusy(true);
    try {
      const latest = await window.studyLogDesktop!.configuration();
      if (!live.current) return;
      if (latest.instanceId !== saved.instanceId) throw Error();
      let previous: { operationId?: string; expectedRevision?: number } | null = null; try { previous = JSON.parse(sessionStorage.getItem(receiptKey) || "null"); } catch { /* Ignore malformed local state. */ }
      if (pending && latest.operationId === pending.payload.operationId && latest.revision > Number(pending.payload.expectedRevision) || previous?.operationId && latest.operationId === previous.operationId && latest.revision > Number(previous.expectedRevision)) { receipt(null); setNeedsReview(false); setSaved(latest); setPending(null); setApiUrl(""); setApiKey(""); setClearKey(false); setRequiresEndpoint(false); onDirty(false); setNotice("已确认设置保存成功。"); await onSaved(); return; }
      if (!pending && previous && latest.revision === previous.expectedRevision) { receipt(null); setUnresolvedReceipt(false); setNotice("上次设置尚未保存，请重新填写需要修改的内容。"); }
      else if (previous && latest.revision !== previous.expectedRevision && latest.operationId !== previous.operationId) { setUnresolvedReceipt(true); setNotice("上次保存结果无法确认，请核对当前设置。"); }
      if (latest.revision !== saved.revision) { setApiKey(""); setClearKey(false); setModels([]); setChecked(false); setPreview(null); if (provider === "custom" && !apiUrl.trim()) setRequiresEndpoint(true); setPending(null); setNotice("设置已在另一处更新。请核对地址并重新填写密钥，其他填写内容仍保留。"); }
      else if (!previous) setNotice("已核对最新设置，填写内容仍保留。");
      setSaved(latest);
    }
    catch { if (live.current) setNotice("无法读取最新设置，填写内容仍保留。"); }
    finally { if (live.current) setBusy(false); }
  }
  async function probe(action: "models" | "test") {
    if (busy || !window.studyLogDesktop) return;
    const url = provider === "deepseek" && saved.provider !== "deepseek" ? "https://api.deepseek.com/chat/completions" : apiUrl.trim();
    if (clearKey) { setNotice("请先填写密钥后再检查。"); return; }
    if (provider === "custom" && (!saved.hasEndpoint || saved.provider !== "custom" || requiresEndpoint) && !url) { setNotice("请输入完整接口地址。"); return; }
    setBusy(true); setChecked(false); setNotice("正在检查…");
    try { const result = await window.studyLogDesktop.probe({ action, apiUrl: url, model: model.trim(), apiKey, expectedRevision: saved.revision, expectedInstanceId: saved.instanceId });
      if (!live.current) return;
      if (result.cancelled) setNotice(""); else if (action === "models") { setModels(result.models || []); setNotice(`已读取 ${result.models?.length || 0} 个模型，也可以手动填写。`); } else { setChecked(true); setNotice(""); }
    } catch (error) { if (live.current) setNotice(String(error).replace(/^Error: Error invoking remote method '[^']+': Error: /, "") || "检查未完成，请重试。"); }
    finally { if (live.current) setBusy(false); }
  }
  async function readDeployment() {
    if (busy || !window.studyLogDesktop) return; setBusy(true);
    try { const result = await window.studyLogDesktop.deploymentPreview(); if (live.current) { setPreview(result); setNotice("已读取部署配置，请核对后决定是否恢复。"); } }
    catch { if (live.current) setNotice("无法读取部署配置，请重试。"); } finally { if (live.current) setBusy(false); }
  }
  async function restoreDeployment() {
    setConfirmRestore(false); if (busy || !preview || !window.studyLogDesktop) return;
    try { if (!pending && sessionStorage.getItem(receiptKey)) { setNotice("上次保存结果尚待核对，请先读取最新设置。"); return; } } catch { /* Storage is optional. */ }
    if (pending && pending.action !== "restore") { setNotice("上次保存结果尚待核对，请先读取最新设置。"); return; }
    const operation = pending?.payload || { expectedInstanceId: saved.instanceId, expectedRevision: preview.revision, operationId: crypto.randomUUID(), previewId: preview.previewId };
    setPending({ action: "restore", payload: operation }); receipt({ operationId: operation.operationId, expectedRevision: operation.expectedRevision }); setBusy(true);
    try { const result = await window.studyLogDesktop.deploymentRestore(operation); if (!live.current) return; if (result.instanceId !== saved.instanceId || result.operationId !== operation.operationId || !Number.isSafeInteger(result.revision) || result.revision <= Number(operation.expectedRevision)) throw Error();
      receipt(null); setNeedsReview(false); setSaved(result); setProvider(result.provider); setModel(result.model); setLightModel(result.lightModel || ""); setCapacity(result.contextWindowTokens || ""); setThinking(result.thinking || ""); setCapacityTouched(false); setThinkingTouched(false); setTargetChanged(false); setApiUrl(""); setApiKey(""); setClearKey(false); setPending(null); setPreview(null); onDirty(false); setNotice("设置已保存，将用于新开始的任务。"); await onSaved();
    } catch { if (live.current) { setNeedsReview(true); setNotice("暂时无法确认保存结果，请核对最新设置。"); } } finally { if (live.current) setBusy(false); }
  }
  return <><form className="settings-form" onSubmit={submit}>
    <label>服务商<select value={provider} disabled={busy} onChange={event => { setProvider(event.target.value === "deepseek" ? "deepseek" : "custom"); setApiUrl(""); setApiKey(""); setClearKey(false); targetEdited(); }}><option value="deepseek">DeepSeek</option><option value="custom">自定义服务</option></select></label>
    {provider === "custom" && <label>完整接口地址<input value={apiUrl} disabled={busy} onChange={event => { setApiUrl(event.target.value); targetEdited(); }} placeholder={saved.hasEndpoint ? `${saved.endpointDisplay || "已设置"}（留空保留原地址）` : "https://example.com/v1/chat/completions"} /></label>}
    <label>API Key<input type="password" autoComplete="off" value={apiKey} disabled={busy || clearKey} onChange={event => { setApiKey(event.target.value); changed(); }} placeholder={saved.hasKey ? "已设置，留空保留原密钥" : "填写服务商提供的 API Key"} /></label>
    {saved.hasKey && <label className="settings-check"><input type="checkbox" checked={clearKey} disabled={busy} onChange={event => { setClearKey(event.target.checked); changed(); }} />移除已保存的 Key</label>}
    <div className="settings-model-row"><label>模型<input list="local-settings-models" value={model} disabled={busy} onChange={event => { setModel(event.target.value); targetEdited(); }} placeholder="填写服务商提供的模型名称" /></label>{provider === "deepseek" && <button type="button" className="button secondary" disabled={busy} onClick={() => void probe("models")}>读取模型</button>}</div><datalist id="local-settings-models">{models.map(item => <option key={item} value={item} />)}</datalist>
    <details><summary>更多选项</summary><label>轻量任务模型<input value={lightModel} disabled={busy} onChange={event => { setLightModel(event.target.value); changed(); }} placeholder="沿用上方模型" /></label>
      <label>上下文容量<input inputMode="numeric" value={capacity} disabled={busy} onChange={event => { setCapacity(event.target.value); setCapacityTouched(true); changed(); }} placeholder="不指定；填写大于 98304 的整数" /></label><p className="settings-intro">更换服务地址或模型后，请重新确认容量。</p>{provider === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(model.trim()) && <label>推理参数<select value={thinking} disabled={busy} onChange={event => { setThinking(event.target.value); setThinkingTouched(true); changed(); }}><option value="">服务默认</option><option value="disabled">关闭思考</option><option value="low">低强度思考</option></select></label>}
      <p className="settings-intro">工具调用：{saved.toolCallingVerified ? "已验证" : "未验证"}；回答检查：{saved.statusVerificationEnabled ? "已验证" : "未验证"}。</p><button type="button" className="button secondary" disabled={busy} onClick={() => void readDeployment()}>恢复部署配置</button></details>
    <div className="settings-action-list"><button type="button" className="button secondary" disabled={busy} onClick={() => void probe("test")}>尝试生成</button>{checked && <span role="status">生成检查通过</span>}</div>
    {preview && <AiSettingsPreview preview={preview} busy={busy} onRestore={() => setConfirmRestore(true)} />}
    {notice && <p role="status" className="settings-notice">{notice}</p>}
    {unresolvedReceipt && <button type="button" className="button secondary" onClick={() => { receipt(null); setPending(null); setUnresolvedReceipt(false); setNotice("请核对地址与密钥后继续编辑。"); }}>已核对，继续编辑</button>}
    <div className="settings-actions">{needsReview && <button type="button" className="button secondary" onClick={() => void reload()} disabled={busy}>核对最新设置</button>}<button type="submit" className="button primary" disabled={busy}>{busy ? "正在保存…" : "保存设置"}</button></div>
  </form>{confirmRestore && <ConfirmDialog open title="恢复部署配置？" message="将使用刚才核对的部署配置，新开始的任务会使用恢复后的设置。" confirmLabel="确认恢复" onCancel={() => setConfirmRestore(false)} onConfirm={() => void restoreDeployment()} />}</>;
}

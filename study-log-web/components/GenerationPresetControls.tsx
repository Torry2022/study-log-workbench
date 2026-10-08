"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Plus, Settings2, Trash2, X } from "lucide-react";
import type { GenerationPreset } from "@/lib/generation-presets-types";
import type { GenerationPresetsController } from "@/hooks/use-generation-presets";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import { ConfirmDialog, type ConfirmationOptions } from "./ConfirmDialog";
import "@/app/generation-presets.css";

export function GenerationPresetControls({ presets, disabled }: { presets: GenerationPresetsController; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="generation-preset-picker">
      <label htmlFor="generation-preset">生成方案</label>
      <div className="generation-preset-picker-row">
        <select id="generation-preset" value={presets.selectedId} disabled={disabled || presets.loading || presets.saving || !presets.snapshot}
          onChange={event => presets.setSelectedId(event.target.value)}>
          {presets.snapshot ? presets.snapshot.presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}{preset.id === presets.snapshot?.defaultPresetId ? "（默认）" : ""}</option>) : <option value="legacy">现有默认方案</option>}
        </select>
        <button className="mini-button" type="button" title="管理生成方案" aria-label="管理生成方案" disabled={disabled || !presets.snapshot} onClick={() => setOpen(true)}><Settings2 size={15} /></button>
      </div>
      {presets.error && !open && <div className="generation-preset-error" role="alert">{presets.error}<button className="mini-button" type="button" disabled={presets.loading || presets.saving} onClick={() => void presets.refresh()}>重试</button></div>}
    </div>
    {open && <GenerationPresetManager presets={presets} onClose={() => setOpen(false)} />}
  </>;
}

function GenerationPresetManager({ presets, onClose }: { presets: GenerationPresetsController; onClose: () => void }) {
  const initial = presets.snapshot!.presets.find(item => item.id === presets.selectedId)!;
  const [editingId, setEditingId] = useState(initial.id);
  const [name, setName] = useState(initial.name);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [saved, setSaved] = useState({ name: initial.name, prompt: initial.prompt, version: presets.snapshot!.version });
  const [confirmation, setConfirmation] = useState<(ConfirmationOptions & { accept: () => void }) | null>(null);
  const [notice, setNotice] = useState("");
  const [serverCopy, setServerCopy] = useState<GenerationPreset | null>(null);
  const selected = presets.snapshot!.presets.find(item => item.id === editingId);
  const readOnly = Boolean(selected?.readOnly);
  const dirty = name !== saved.name || prompt !== saved.prompt || editingId === "";
  const busy = presets.saving || presets.loading;
  const { backdropRef, requestExit } = useDialogExit(close);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; const unlock = lockBodyScroll(); return () => { mounted.current = false; unlock(); }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function guard(action: () => void) {
    if (busy) return;
    if (!dirty) { action(); return; }
    setConfirmation({ title: "放弃方案修改？", message: "当前方案修改尚未保存。", confirmLabel: "放弃", tone: "danger", accept: action });
  }
  function close() { guard(() => requestExit(onClose)); }
  function edit(preset: GenerationPreset, version = presets.snapshot!.version) {
    setEditingId(preset.id); setName(preset.name); setPrompt(preset.prompt);
    setSaved({ name: preset.name, prompt: preset.prompt, version }); setNotice(""); setServerCopy(null);
  }
  function create(copy?: GenerationPreset) {
    guard(() => {
      setEditingId(""); setName(copy ? `${copy.name}（副本）` : ""); setPrompt(copy?.prompt || "");
      setSaved({ name: "", prompt: "", version: presets.snapshot!.version }); setNotice(""); setServerCopy(null);
    });
  }
  async function save() {
    if (readOnly || !name.trim() || !prompt.trim() || busy) return;
    const previousIds = new Set(presets.snapshot!.presets.map(item => item.id));
    const result = await presets.save(editingId ? "PATCH" : "POST", { ...(editingId ? { id: editingId } : {}), name, prompt }, saved.version);
    if (!result || !mounted.current) return;
    const item = result.presets.find(preset => editingId ? preset.id === editingId : !previousIds.has(preset.id));
    if (item) { edit(item, result.version); presets.setSelectedId(item.id); setNotice("方案已保存"); }
  }
  function remove() {
    if (!selected || readOnly || busy) return;
    setConfirmation({ title: "删除个人方案？", message: `删除“${selected.name}”后不能在列表中恢复；已生成的日志不受影响。`, confirmLabel: "删除", tone: "danger", accept: () => {
      void (async () => {
        const result = await presets.save("DELETE", { id: selected.id }, saved.version);
        if (result && mounted.current) { edit(result.presets.find(item => item.id === result.defaultPresetId)!, result.version); setNotice("方案已删除"); }
      })();
    } });
  }
  function reload() {
    guard(() => { void (async () => {
      const result = await presets.refresh();
      if (result && mounted.current) edit(result.presets.find(item => item.id === editingId) || result.presets.find(item => item.id === result.defaultPresetId)!, result.version);
    })(); });
  }
  async function refreshVersion() {
    const result = await presets.refresh();
    if (!result || !mounted.current) return;
    setSaved(value => ({ ...value, version: result.version }));
    const latest = result.presets.find(item => item.id === editingId);
    setServerCopy(latest || null);
    setNotice(editingId && !latest ? "原方案已被删除；当前输入已保留，可复制为新方案。" : "你的修改已保留。请对照最新内容，确认后再保存。");
  }
  async function setDefault() {
    if (!selected || dirty || busy || selected.issue) return;
    const result = await presets.save("PATCH", { defaultPresetId: selected.id }, saved.version);
    if (result && mounted.current) { setSaved(value => ({ ...value, version: result.version })); setNotice("默认方案已更新"); }
  }
  return createPortal(<>
    <div ref={backdropRef} className="generation-presets-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section className="generation-presets-dialog" role="dialog" aria-modal="true" aria-labelledby="generation-presets-title">
        <header><h2 id="generation-presets-title">生成方案</h2><button type="button" className="mini-button" aria-label="关闭生成方案" disabled={busy} onClick={close}><X size={18} /></button></header>
        <div className="generation-presets-body">
          <aside aria-label="生成方案列表">
            <button type="button" className="button secondary" disabled={busy} onClick={() => create()}><Plus size={15} />新增方案</button>
            {presets.snapshot!.presets.map(preset => <button type="button" key={preset.id} className={`generation-preset-item${editingId === preset.id ? " active" : ""}`} disabled={busy}
              onClick={() => guard(() => edit(preset))}><span>{preset.name}</span><small>{preset.id === presets.snapshot!.defaultPresetId ? "默认 · " : ""}{preset.id === "legacy" ? "原有模板" : preset.readOnly ? "内置" : "个人"}</small></button>)}
          </aside>
          <div className="generation-presets-editor">
            <label htmlFor="preset-name">方案名称</label><input id="preset-name" value={name} readOnly={readOnly} disabled={busy} maxLength={80} onChange={event => setName(event.target.value)} />
            <label htmlFor="preset-prompt">提示词</label><textarea id="preset-prompt" value={prompt} readOnly={readOnly} disabled={busy} onChange={event => setPrompt(event.target.value)} />
            {readOnly && <p className="generation-presets-hint">{editingId === "legacy" ? "沿用原有写作提示词，可复制后修改。" : "内置方案只读，可复制后编辑。"}</p>}
            {selected?.issue && <p className="generation-preset-error" role="alert">{selected.issue}</p>}
            {presets.error && <p className="generation-preset-error" role="alert">{presets.error}</p>}
            {presets.conflict && <button type="button" className="button secondary" disabled={busy} onClick={() => void refreshVersion()}>查看最新内容</button>}
            {serverCopy && <details className="generation-presets-comparison"><summary>最新保存内容</summary><p>{serverCopy.name}</p><pre>{serverCopy.prompt}</pre></details>}
            {notice && <p className="generation-presets-hint" role="status">{notice}</p>}
            <div className="generation-presets-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={reload}>重新载入</button>
              <button type="button" className="button secondary" disabled={busy || !prompt.trim()} onClick={() => create({ id: "", name, prompt, readOnly: false })}><Copy size={14} />复制</button>
              {selected && <button type="button" className="button secondary" disabled={busy || dirty || Boolean(selected.issue) || presets.snapshot!.defaultPresetId === selected.id} onClick={() => void setDefault()}>设为默认</button>}
              {selected && !readOnly && <button type="button" className="button danger" disabled={busy} onClick={remove}><Trash2 size={14} />删除</button>}
              {!readOnly && <button type="button" className="button primary" disabled={busy || !dirty || !name.trim() || !prompt.trim()} onClick={() => void save()}>{presets.saving ? "保存中…" : "保存方案"}</button>}
            </div>
          </div>
        </div>
      </section>
    </div>
    {confirmation && <ConfirmDialog open {...confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => { const accept = confirmation.accept; setConfirmation(null); accept(); }} />}
  </>, document.body);
}

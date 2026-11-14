"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BookOpen, Bot, Info, Monitor, Settings, X } from "lucide-react";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import { requestJson } from "@/lib/client-http";
import type { DesktopAiConfiguration } from "@/lib/desktop-client";
import { WorkspaceState } from "./WorkspaceState";
import { ConfirmDialog } from "./ConfirmDialog";
import { LocalAiSettings } from "./LocalAiSettings";
import { RemoteAiSettings, type RemoteAiSummary } from "./RemoteAiSettings";
import "@/app/help.css";
import "@/app/settings-dialog.css";

type SettingsCapability = { protocolVersion: number; readable: boolean; writable: boolean; reason?: string };
type Capabilities = { instanceId: string; serverVersion?: string; settings?: { ai?: SettingsCapability }; aiConfiguration?: { provider?: { configured?: boolean } } };
type AiSummary = RemoteAiSummary & { source: string };
type Content = { kind: "loading" } | { kind: "legacy"; configured?: boolean } | { kind: "unavailable" } | { kind: "ready"; summary: AiSummary } | { kind: "error" };
type Page = "menu" | "records" | "ai" | "appearance" | "about";
const sections = [{ id: "records", label: "学习记录", Icon: BookOpen }, { id: "ai", label: "AI 服务", Icon: Bot }, { id: "appearance", label: "外观", Icon: Monitor }, { id: "about", label: "关于与连接详情", Icon: Info }] as const;

function AiMaintenanceHelp() {
  return <details className="settings-help"><summary>如何配置 AI 服务</summary>
    <p>如果是自己部署的工作台，可以按照部署说明配置模型服务，并让配置生效。如果由他人部署，请联系工作台维护者。</p>
    <a href="https://github.com/Torry2022/study-log-workbench/blob/main/deploy/README.md" target="_blank" rel="noopener noreferrer">查看部署说明</a>
  </details>;
}

export function SettingsDialog({ onClose, initialPage = "menu", returnOnSave = false, themePreference, onTheme }: { onClose: () => void; initialPage?: Page; returnOnSave?: boolean; themePreference: "system" | "light" | "dark"; onTheme: (value: "system" | "light" | "dark") => void }) {
  const [content, setContent] = useState<Content>({ kind: "loading" });
  const [desktop, setDesktop] = useState<{ mode: "local" | "remote"; root: string; appVersion?: string } | null>(null);
  const [localConfig, setLocalConfig] = useState<DesktopAiConfiguration | null>(null);
  const [serverVersion, setServerVersion] = useState("");
  const [remoteWritable, setRemoteWritable] = useState(false);
  const [page, setPage] = useState<Page>(initialPage), [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"connection" | "backup" | "restore" | null>(null);
  const [attempt, setAttempt] = useState(0), [actionError, setActionError] = useState("");
  const currentPage = page === "menu" ? "records" : page;
  const contentRef = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  const { backdropRef, requestExit } = useDialogExit(close);
  function close() { if (dirty) setConfirmClose(true); else requestExit(onClose); }
  useEffect(() => lockBodyScroll(), []);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (page !== "menu" && contentRef.current) contentRef.current.scrollTop = 0; }, [page]);
  useEffect(() => {
    const controller = new AbortController(); setContent({ kind: "loading" });
    void (async () => {
      try {
        const host = await window.studyLogDesktop?.context(); if (controller.signal.aborted) return;
        if (host) setDesktop(host);
        const capabilities = await requestJson<Capabilities>("/api/capabilities", { signal: controller.signal });
        setServerVersion(capabilities.serverVersion || "");
        if (host?.mode === "local") { const local = await window.studyLogDesktop!.configuration(); if (!controller.signal.aborted) setLocalConfig(local); }
        const feature = capabilities.settings?.ai;
        setRemoteWritable(feature?.writable === true);
        if (!feature || feature.protocolVersion !== 1) { setContent({ kind: "legacy", configured: capabilities.aiConfiguration?.provider?.configured }); return; }
        if (!feature.readable) { setContent({ kind: "unavailable" }); return; }
        const summary = await requestJson<AiSummary>("/api/settings/ai", { signal: controller.signal, headers: { "X-Study-Log-Instance": capabilities.instanceId } });
        if (summary.instanceId !== capabilities.instanceId || typeof summary.hasKey !== "boolean" || typeof summary.hasEndpoint !== "boolean" || !["deepseek", "custom"].includes(summary.provider) || typeof summary.model !== "string" || typeof summary.endpointDisplay !== "string" || typeof summary.lightModel !== "string") throw new Error("Invalid settings response");
        setContent({ kind: "ready", summary });
      } catch { if (!controller.signal.aborted) setContent({ kind: "error" }); }
    })();
    return () => controller.abort();
  }, [attempt]);
  async function savedConfiguration() {
    if (!live.current) return;
    try {
      const capabilities = await requestJson<Capabilities>("/api/capabilities");
      if (!live.current) return;
      if (content.kind === "ready" && capabilities.instanceId !== content.summary.instanceId) throw Error();
      window.dispatchEvent(new Event("study-log:ai-settings-saved"));
      setActionError("");
      if (returnOnSave) requestExit(onClose);
    } catch { if (live.current) setActionError("设置已保存，功能状态暂未更新，请关闭后重新检查。"); }
  }
  async function desktopAction(action: "connection" | "backup" | "restore" | "history" | "folder") {
    if (dirty && (action === "connection" || action === "backup" || action === "restore")) { setConfirmAction(action); return; }
    try { setActionError(""); await window.studyLogDesktop?.settingsAction(action); }
    catch { setActionError("操作未完成，请重试。"); }
  }

  return createPortal(<><div ref={backdropRef} className="help-dialog-backdrop settings-dialog-backdrop" onClick={close}>
    <section className="help-dialog settings-dialog" data-page={page} role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" onClick={event => event.stopPropagation()}>
      <header className="help-dialog-header"><div><span className="help-dialog-icon"><Settings size={20} /></span><div><h2 id="settings-dialog-title">设置</h2><p>当前工作台</p></div></div><button type="button" aria-label="关闭设置" onClick={close}><X size={18} /></button></header>
      <div className="settings-dialog-layout"><nav className="settings-nav" aria-label="设置分类">{sections.map(({ id, label, Icon }) => <button key={id} type="button" aria-current={currentPage === id ? "page" : undefined} onClick={() => setPage(id)}><Icon size={17} />{label}<span aria-hidden="true">›</span></button>)}</nav>
      <div ref={contentRef} className="help-dialog-content settings-dialog-content"><button className="settings-back button secondary" type="button" onClick={() => setPage("menu")}><ArrowLeft size={16} />设置</button>
        <section hidden={currentPage !== "records"}><h3>学习记录</h3><p className="settings-intro">{desktop?.mode === "local" ? "日志、随记和附件保存在这台电脑。" : "学习记录保存在当前工作台服务器上。"}</p>
          {desktop?.mode === "local" && <><p className="settings-path">{desktop.root}</p><div className="settings-action-list"><button type="button" className="button secondary" onClick={() => void desktopAction("folder")}>打开保存文件夹</button><button type="button" className="button secondary" onClick={() => void desktopAction("backup")}>创建完整备份</button><button type="button" className="button secondary" onClick={() => void desktopAction("restore")}>恢复完整备份</button><button type="button" className="button secondary" onClick={() => void desktopAction("history")}>日志历史版本设置</button></div></>}
          {desktop && <button type="button" className="button secondary settings-inline-action" onClick={() => void desktopAction("connection")}>更换工作台</button>}{actionError && <p role="alert">{actionError}</p>}
        </section>
        <section className="settings-ai" hidden={currentPage !== "ai"}><h3 id="settings-ai-title">AI 服务</h3><p className="settings-intro">{desktop?.mode === "local" ? "用于整理学习材料和回顾记录。" : "连接这个工作台的设备共用 AI 服务配置。"}</p>
          {localConfig ? <LocalAiSettings initial={localConfig} onDirty={setDirty} onSaved={savedConfiguration} /> : <>
          {content.kind === "loading" && <WorkspaceState kind="loading" layout="compact" title="正在读取设置" />}
          {content.kind === "error" && <WorkspaceState kind="error" layout="compact" title="无法读取设置" description="请检查连接后重试。" actions={<button className="button secondary" type="button" onClick={() => setAttempt(value => value + 1)}>重试</button>} />}
          {content.kind === "unavailable" && <><WorkspaceState kind="error" layout="compact" title="模型设置暂不可用" description="请联系工作台维护者检查配置。" /><AiMaintenanceHelp /></>}
          {content.kind === "legacy" && <div className="settings-legacy"><p>{content.configured === true ? "模型服务已配置。" : content.configured === false ? "模型服务尚未配置。" : "当前服务器未提供模型配置状态。"}</p><p>当前服务器版本不支持查看详细设置。</p><AiMaintenanceHelp /></div>}
          {content.kind === "ready" && (remoteWritable && Number.isSafeInteger(content.summary.revision) ? <RemoteAiSettings initial={content.summary} onDirty={setDirty} onSaved={savedConfiguration} /> : <><dl className="settings-summary"><div><dt>服务商</dt><dd>{content.summary.hasEndpoint ? content.summary.provider === "deepseek" ? "DeepSeek" : "自定义服务" : "未设置"}</dd></div><div><dt>服务地址</dt><dd>{content.summary.hasEndpoint ? content.summary.endpointDisplay || "已设置" : "未设置"}</dd></div><div><dt>模型</dt><dd>{content.summary.model || "未设置"}</dd></div><div><dt>API Key</dt><dd>{content.summary.hasKey ? "已设置" : "未设置"}</dd></div>{content.summary.lightModel && <div><dt>轻量任务模型</dt><dd>{content.summary.lightModel}</dd></div>}</dl><p className="settings-maintenance">模型设置由工作台维护者管理。</p><AiMaintenanceHelp /></>)}</>}
          {actionError && <p role="alert">{actionError}</p>}
        </section>
        <section hidden={page !== "appearance"}><h3>外观</h3><div className="settings-theme" role="group" aria-label="主题模式">{([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] as const).map(([value, label]) => <button type="button" key={value} className="button secondary" aria-pressed={themePreference === value} onClick={() => onTheme(value)}>{label}</button>)}</div></section>
        <section hidden={page !== "about"}><h3>关于与连接详情</h3>
          <dl className="settings-summary">
            {desktop?.appVersion && <div><dt>桌面版本</dt><dd>{desktop.appVersion}</dd></div>}
            <div><dt>工作台版本</dt><dd>{serverVersion || "未提供"}</dd></div>
            <div><dt>使用方式</dt><dd>{desktop?.mode === "local" ? "本机" : desktop?.mode === "remote" ? "连接服务器" : "浏览器"}</dd></div>
            {desktop?.mode !== "local" && <div><dt>工作台地址</dt><dd>{window.location.origin}/study-log</dd></div>}
          </dl>
        </section>
      </div></div>
    </section>
  </div>{confirmClose && <ConfirmDialog open title="放弃未保存的设置？" message="填写的设置尚未保存，关闭后需要重新填写。" confirmLabel="放弃并关闭" cancelLabel="继续编辑" onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); requestExit(onClose); }} />}
    {confirmAction && <ConfirmDialog open title="放弃未保存的设置？" message="继续操作会丢弃当前填写的设置。" confirmLabel="放弃并继续" cancelLabel="继续编辑" onCancel={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction; setConfirmAction(null); requestExit(() => { onClose(); void window.studyLogDesktop?.settingsAction(action); }); }} />}</>, document.body);
}

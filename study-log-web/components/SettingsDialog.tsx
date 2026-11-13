"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import { lockBodyScroll, useDialogExit } from "@/hooks/use-dialog-exit";
import { requestJson } from "@/lib/client-http";
import { WorkspaceState } from "./WorkspaceState";
import "@/app/help.css";
import "@/app/settings-dialog.css";

type SettingsCapability = { protocolVersion: number; readable: boolean; writable: boolean; reason?: string };
type Capabilities = { instanceId: string; settings?: { ai?: SettingsCapability }; aiConfiguration?: { provider?: { configured?: boolean } } };
type AiSummary = { instanceId: string; provider: string; endpointDisplay: string; hasEndpoint: boolean; model: string; hasKey: boolean; lightModel: string; source: string };
type Content = { kind: "loading" } | { kind: "legacy"; configured?: boolean } | { kind: "unavailable" } | { kind: "ready"; summary: AiSummary } | { kind: "error" };

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [content, setContent] = useState<Content>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const { backdropRef, requestExit } = useDialogExit(close);
  function close() { requestExit(onClose); }
  useEffect(() => lockBodyScroll(), []);
  useEffect(() => {
    const controller = new AbortController();
    setContent({ kind: "loading" });
    void (async () => {
      try {
        const capabilities = await requestJson<Capabilities>("/api/capabilities", { signal: controller.signal });
        const feature = capabilities.settings?.ai;
        if (!feature || feature.protocolVersion !== 1) {
          setContent({ kind: "legacy", configured: capabilities.aiConfiguration?.provider?.configured }); return;
        }
        if (!feature.readable) { setContent({ kind: "unavailable" }); return; }
        const summary = await requestJson<AiSummary>("/api/settings/ai", { signal: controller.signal,
          headers: { "X-Study-Log-Instance": capabilities.instanceId } });
        if (summary.instanceId !== capabilities.instanceId || typeof summary.hasKey !== "boolean" || typeof summary.model !== "string" || typeof summary.endpointDisplay !== "string") throw new Error("Invalid settings response");
        setContent({ kind: "ready", summary });
      } catch { if (!controller.signal.aborted) setContent({ kind: "error" }); }
    })();
    return () => controller.abort();
  }, [attempt]);

  return createPortal(<div ref={backdropRef} className="help-dialog-backdrop settings-dialog-backdrop" onClick={close}>
    <section className="help-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title" onClick={event => event.stopPropagation()}>
      <header className="help-dialog-header"><div><span className="help-dialog-icon"><Settings size={20} /></span><div><h2 id="settings-dialog-title">设置</h2><p>当前工作台</p></div></div><button type="button" aria-label="关闭设置" onClick={close}><X size={18} /></button></header>
      <div className="help-dialog-content settings-dialog-content">
        <section aria-labelledby="settings-ai-title"><h3 id="settings-ai-title">AI 服务</h3>
          <p className="settings-intro">连接这个工作台的设备共用 AI 服务配置。</p>
          {content.kind === "loading" && <WorkspaceState kind="loading" layout="compact" title="正在读取设置" />}
          {content.kind === "error" && <WorkspaceState kind="error" layout="compact" title="无法读取设置" description="请检查连接后重试。" actions={<button className="button secondary" type="button" onClick={() => setAttempt(value => value + 1)}>重试</button>} />}
          {content.kind === "unavailable" && <WorkspaceState kind="error" layout="compact" title="模型设置暂不可用" description="请联系工作台维护者检查配置。" />}
          {content.kind === "legacy" && <div className="settings-legacy"><p>{content.configured === true ? "模型服务已配置。" : content.configured === false ? "模型服务尚未配置。" : "当前服务器未提供模型配置状态。"}</p><p>当前服务器版本不支持查看详细设置，请联系工作台维护者。</p></div>}
          {content.kind === "ready" && <><dl className="settings-summary">
            <div><dt>服务商</dt><dd>{content.summary.hasEndpoint ? content.summary.provider === "deepseek" ? "DeepSeek" : "自定义服务" : "未设置"}</dd></div>
            <div><dt>服务地址</dt><dd>{content.summary.hasEndpoint ? content.summary.endpointDisplay || "已设置" : "未设置"}</dd></div>
            <div><dt>模型</dt><dd>{content.summary.model || "未设置"}</dd></div>
            <div><dt>API Key</dt><dd>{content.summary.hasKey ? "已设置" : "未设置"}</dd></div>
            {content.summary.lightModel && <div><dt>轻量任务模型</dt><dd>{content.summary.lightModel}</dd></div>}
          </dl><p className="settings-maintenance">模型设置由工作台维护者管理。如需修改，请联系维护者。</p></>}
        </section>
      </div>
    </section>
  </div>, document.body);
}

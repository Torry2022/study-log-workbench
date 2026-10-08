"use client";

import { Edit3, X } from "lucide-react";
import { WorkspaceState } from "./WorkspaceState";
import { FeatureAvailability } from "./FeatureAvailability";
import type { HighlightingController } from "@/hooks/use-highlighting";
import "@/app/highlighting.css";

export function HighlightPanel({ highlighting }: { highlighting: HighlightingController }) {
  if (!highlighting.active) return null;
  return <div className="highlight-panel">
    <div className="highlight-helper"><h3>为当前日志标注重点</h3><p>挑出值得回顾的概念、结论和必要条件，以加粗标记重点，保留原文。</p></div>
    {(highlighting.configurationError || highlighting.configurationMessages.length > 0) && <FeatureAvailability title={highlighting.configurationError ? "暂时无法检查 AI 服务" : "暂时无法使用重点标注"} description="配置模型后，可为日志中的重点内容添加标注。" messages={highlighting.configurationError ? [highlighting.configurationError] : highlighting.configurationMessages} busy={highlighting.configurationLoading} onCheck={() => void highlighting.refreshConfiguration()} />}
    {!highlighting.date && <WorkspaceState kind="empty" title="未选择日志" description="打开一篇有正文的日志，可为其中的内容标注重点。" layout="compact" className="inspector-empty-state" />}
    {highlighting.date && highlighting.inputProblem && <p className="status-line warning">{highlighting.inputProblem}</p>}
    <button className="button primary" type="button" disabled={highlighting.busy || !highlighting.configured || Boolean(highlighting.inputProblem)} onClick={() => void highlighting.request()}><Edit3 size={15} />{highlighting.busy ? "标注中" : "标注重点"}</button>
    {highlighting.busy && <><p className="status-line pending" role="status">正在标注当前编辑草稿…</p><button className="button secondary-on-dark" type="button" onClick={highlighting.cancel}><X size={14} />取消标注</button></>}
    {highlighting.status && <p className={`status-line ${highlighting.statusKind}`} role={highlighting.statusKind === "error" ? "alert" : "status"}>{highlighting.status}</p>}
    <p className="status-line">标注结果会先进入差异查看，确认后只替换当前编辑草稿，不会自动保存到 Markdown 文件。</p>
  </div>;
}

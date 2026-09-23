"use client";

import { Edit3, X } from "lucide-react";
import { FeatureAvailability } from "./FeatureAvailability";
import type { HighlightingController } from "@/hooks/use-highlighting";
import "@/app/highlighting.css";

export function HighlightPanel({ highlighting }: { highlighting: HighlightingController }) {
  if (!highlighting.active) return null;
  return <div className="highlight-panel">
    <div className="highlight-helper"><h3>为当前日块标注重点</h3><p>从技术含义判断核心概念、关键机制、参数指标和结论，只插入 Markdown 加粗标记，不改写原文。</p></div>
    {(highlighting.configurationError || highlighting.configurationMessages.length > 0) && <FeatureAvailability dark title={highlighting.configurationError ? "暂时无法检查 AI 服务" : "重点标注尚未启用"} description="启用 AI 服务后，可为当前日志建议重点标记。" messages={highlighting.configurationError ? [highlighting.configurationError] : highlighting.configurationMessages} busy={highlighting.configurationLoading} onCheck={() => void highlighting.refreshConfiguration()} />}
    {highlighting.inputProblem && <p className="status-line warning">{highlighting.inputProblem}</p>}
    <button className="button primary" type="button" disabled={highlighting.busy || !highlighting.configured || Boolean(highlighting.inputProblem)} onClick={() => void highlighting.request()}><Edit3 size={15} />{highlighting.busy ? "标注中" : "标注重点"}</button>
    {highlighting.busy && <><p className="status-line pending" role="status">正在标注当前编辑草稿…</p><button className="button secondary-on-dark" type="button" onClick={highlighting.cancel}><X size={14} />取消标注</button></>}
    {highlighting.status && <p className={`status-line ${highlighting.statusKind}`} role={highlighting.statusKind === "error" ? "alert" : "status"}>{highlighting.status}</p>}
    <p className="status-line">标注结果会先进入差异查看，确认后只替换当前编辑草稿，不会自动保存到 Markdown 文件。</p>
  </div>;
}

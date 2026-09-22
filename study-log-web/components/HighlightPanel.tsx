"use client";

import { Edit3, RefreshCw, X } from "lucide-react";
import type { HighlightingController } from "@/hooks/use-highlighting";
import "@/app/highlighting.css";

export function HighlightPanel({ highlighting }: { highlighting: HighlightingController }) {
  if (!highlighting.active) return null;
  return <div className="highlight-panel">
    <div className="highlight-helper"><h3>为当前日块标注重点</h3><p>从技术含义判断核心概念、关键机制、参数指标和结论，只插入 Markdown 加粗标记，不改写原文。</p></div>
    {(highlighting.configurationError || highlighting.configurationMessages.length > 0) && <div className="highlight-configuration">
      {highlighting.configurationError ? <p className="status-line error" role="alert">{highlighting.configurationError}</p> : highlighting.configurationMessages.map(message => <p className="status-line warning" key={message}>{message}</p>)}
      <button className="button secondary-on-dark" type="button" disabled={highlighting.configurationLoading} onClick={() => void highlighting.refreshConfiguration()}><RefreshCw size={14} />重新检查标注配置</button>
    </div>}
    {highlighting.inputProblem && <p className="status-line warning">{highlighting.inputProblem}</p>}
    <button className="button primary" type="button" disabled={highlighting.busy || !highlighting.configured || Boolean(highlighting.inputProblem)} onClick={() => void highlighting.request()}><Edit3 size={15} />{highlighting.busy ? "标注中" : "标注重点"}</button>
    {highlighting.busy && <><p className="status-line pending" role="status">正在标注当前编辑草稿…</p><button className="button secondary-on-dark" type="button" onClick={highlighting.cancel}><X size={14} />取消标注</button></>}
    {highlighting.status && <p className={`status-line ${highlighting.statusKind}`} role={highlighting.statusKind === "error" ? "alert" : "status"}>{highlighting.status}</p>}
    <p className="status-line">标注结果会先进入差异查看，确认后只替换当前编辑草稿，不会自动保存到 Markdown 文件。</p>
  </div>;
}

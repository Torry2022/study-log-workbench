"use client";

import { Check, Upload, Wand2, X } from "lucide-react";
import { FeatureAvailability } from "./FeatureAvailability";
import { GenerationPresetControls } from "./GenerationPresetControls";
import { useEffect, useRef } from "react";
import type { WritingController } from "@/hooks/use-writing";
import "@/app/writing.css";

export function WritingPanel({ writing }: { writing: WritingController; themeMode: "light" | "dark" }) {
  const instruction = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!instruction.current || !writing.active || !writing.visible) return;
    instruction.current.style.height = "auto";
    instruction.current.style.height = `${Math.min(Math.max(instruction.current.scrollHeight, 40), 140)}px`;
  }, [writing.instruction, writing.active, writing.visible]);
  if (!writing.active) return null;
  return <div className="writing-panel panel-body">
    {(writing.configurationError || writing.configurationMessages.length > 0) && <FeatureAvailability dark title={writing.configurationError ? "暂时无法检查 AI 服务" : "AI 写作尚未启用"} description="仍可导入和整理材料，启用后即可生成草稿。" messages={writing.configurationError ? [writing.configurationError] : writing.configurationMessages} busy={writing.configurationLoading} onCheck={() => void writing.refreshConfiguration()} />}
    <GenerationPresetControls presets={writing.presets} disabled={Boolean(writing.busy)} />
    <label htmlFor="writing-instruction">补充要求</label>
    <textarea id="writing-instruction" ref={instruction} className="dark-input instruction-textarea" value={writing.instruction} onChange={event => writing.setInstruction(event.target.value)} placeholder="例如：简写、突出项目实践、保留术语" rows={1} />
    <div className="field-row"><label htmlFor="writing-material">学习材料</label><label className={`mini-button file-button${writing.busy ? " disabled" : ""}`}><Upload size={14} />{writing.busy === "import" ? "导入中" : "导入文件"}
      <input type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx,.pptx" aria-label="导入学习材料文件" disabled={Boolean(writing.busy)} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void writing.importFiles(files); }} />
    </label></div>
    <textarea id="writing-material" className="material-textarea" value={writing.material} onChange={event => writing.setMaterial(event.target.value)} placeholder="粘贴笔记、代码片段、课程内容或项目进展" />
    {writing.inputProblem && (writing.material || writing.instruction) && <p className="status-line warning">{writing.inputProblem}</p>}
    <button className="button primary full" type="button" onClick={() => void writing.generate()} disabled={Boolean(writing.busy) || writing.presets.loading || writing.presets.saving || !writing.configured || Boolean(writing.inputProblem)}><Wand2 size={15} />{writing.busy === "generate" ? "生成中" : "生成日志草稿"}</button>
    {writing.busy === "generate" && <p className="status-line pending" role="status">正在生成日志草稿…</p>}
    {writing.busy && writing.busy !== "apply" && <button className="mini-button" type="button" onClick={writing.cancelOperation}><X size={13} />取消当前操作</button>}
    {writing.status && <p className={`status-line ${writing.statusKind}`} role={writing.statusKind === "error" ? "alert" : "status"}>{writing.status}</p>}
    {[...writing.materialWarnings, ...writing.generationWarnings].map((warning, index) => <p className="status-line warning" key={`${index}:${warning}`}>{warning}</p>)}
    {writing.output && writing.outputDate && writing.outputDate !== writing.date && <p className="status-line warning">该草稿属于 {writing.outputDate}，切回对应日块后才能追加。</p>}
    <label htmlFor="writing-output">生成草稿</label>
    <textarea id="writing-output" className="ai-output" value={writing.busy === "generate" && !writing.output ? "正在生成，请稍候..." : writing.output} onChange={event => writing.setOutput(event.target.value)} readOnly={writing.busy === "generate" && !writing.output} />
    <button className="button secondary-on-dark full" type="button" onClick={() => void writing.apply()} disabled={Boolean(writing.busy) || !writing.output.trim() || writing.outputDate !== writing.date}><Check size={15} />追加到编辑器</button>
    <p className="status-line">追加后仍需在日志编辑器中保存，才会写入资料。</p>
  </div>;
}

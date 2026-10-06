"use client";

import { ChevronLeft, FileText, Save, Trash2, Upload, WandSparkles, X } from "lucide-react";
import { useRef } from "react";
import { FeatureAvailability } from "./FeatureAvailability";
import type { NoteCandidatesController } from "@/hooks/use-note-candidates";
import { localDateTimeInput } from "@/lib/notes-view";
import "@/app/notes-candidates.css";

export function NoteCandidateExtractor({ extraction }: { extraction: NoteCandidatesController }) {
  const input = useRef<HTMLInputElement>(null);
  const selectedCount = extraction.candidates.filter(item => item.selected).length;
  return <section className="notes-ai-workspace" aria-label="AI提取随记">
    <div className="notes-composer-heading"><div className="notes-composer-identity"><button type="button" disabled={extraction.busy === "save"} onClick={() => void extraction.beforeLeave()} aria-label="返回随记列表"><ChevronLeft size={18} /></button><div><span>AI提取</span><small>从材料整理候选，核对后保存为随记</small></div></div></div>
    <div className="notes-ai-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); extraction.addFiles(Array.from(event.dataTransfer.files)); }}>
      <div className="notes-ai-upload-copy"><Upload size={26} /><div><strong>上传文章、摘录或观点材料</strong><span>支持 TXT、Markdown、PDF、DOCX、PPTX，每次最多5个，单个不超过20 MiB</span></div></div>
      <button className="button secondary" type="button" disabled={extraction.locked} onClick={() => input.current?.click()}><Upload size={15} />选择文件</button>
      <input ref={input} type="file" hidden multiple aria-label="提取随记材料文件" accept=".txt,.md,.markdown,.pdf,.docx,.pptx" onChange={event => { extraction.addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </div>
    {extraction.files.length > 0 && <div className="notes-ai-files">{extraction.files.map((file, index) => <div className="notes-ai-file" key={`${file.name}:${index}`}><FileText size={17} /><div><strong>{file.name}</strong><span>{Math.max(1, Math.round(file.size / 1024))} KB</span></div><button type="button" disabled={extraction.locked} onClick={() => extraction.removeFile(index)} aria-label={`移除文件：${file.name}`}><X size={15} /></button></div>)}</div>}
    {!extraction.configured && <FeatureAvailability title="AI 提取尚未启用" description="可以先选好材料，配置模型后再提取随记。" messages={extraction.configurationError ? [extraction.configurationError] : extraction.configurationMessages} onCheck={() => void extraction.refreshConfiguration()} />}
    <div className="notes-ai-runbar"><p>提取时会将所选文件的文本发送给实例配置的模型。候选不会自动保存。</p><div><button className="button primary" type="button" disabled={!extraction.configured || !extraction.files.length || extraction.locked} onClick={() => void extraction.extract()}><WandSparkles size={15} />{extraction.busy === "extract" ? "提取中" : extraction.candidates.length ? "重新提取" : "提取随记"}</button>{extraction.busy === "extract" && <button className="button secondary" type="button" onClick={extraction.cancel}>取消提取</button>}</div></div>
    {extraction.error && <div className="notes-error" role="alert">{extraction.error}</div>}
    {extraction.status && <div className="notes-feedback" role="status">{extraction.status}</div>}
    {extraction.retrySave && <div className="notes-feedback" role="status">正在确认本批保存结果。候选暂时锁定；重试会使用相同内容和记录身份，避免重复创建。</div>}
    {extraction.warnings.length > 0 && <div className="notes-ai-warnings" role="status">{extraction.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
    {extraction.candidates.length > 0 && <div className="notes-ai-results">
      <div className="notes-ai-results-heading"><div><div className="notes-ai-results-title"><h3>候选随记</h3><label className="notes-ai-select-all"><input type="checkbox" disabled={extraction.locked} checked={selectedCount === extraction.candidates.length} ref={element => { if (element) element.indeterminate = selectedCount > 0 && selectedCount < extraction.candidates.length; }} onChange={event => extraction.selectAll(event.target.checked)} />全选</label></div><span>{extraction.candidates.length}条候选，已选择{selectedCount}条{extraction.model ? ` · ${extraction.model}` : ""}</span></div><label><span>记录时间</span><input type="datetime-local" disabled={extraction.locked} value={extraction.recordedAt} max={localDateTimeInput()} onChange={event => extraction.setRecordedAt(event.target.value)} /></label></div>
      <div className="notes-ai-candidate-list">{extraction.candidates.map((candidate, index) => <article className={`notes-ai-candidate${candidate.selected ? " selected" : ""}`} aria-label={`候选${index + 1}`} key={candidate.id}>
        <header><label className="notes-ai-candidate-select"><input type="checkbox" aria-label={`选择候选${index + 1}`} disabled={extraction.locked} checked={candidate.selected} onChange={event => extraction.update(candidate.id, { selected: event.target.checked })} /><span>{String(index + 1).padStart(2, "0")}</span></label><span className={`notes-ai-kind ${candidate.kind}`}>{candidate.kind === "explicit" ? "原文明示" : "归纳提炼"}</span><button type="button" disabled={extraction.locked} onClick={() => extraction.remove(candidate.id)} aria-label={`删除候选：${candidate.title}`}><Trash2 size={15} /></button></header>
        <label className="notes-ai-field"><span>标题</span><input aria-label="标题" disabled={extraction.locked} value={candidate.title} maxLength={120} onChange={event => extraction.update(candidate.id, { title: event.target.value })} /></label>
        <label className="notes-ai-field"><span>正文</span><textarea aria-label="正文" disabled={extraction.locked} rows={5} value={candidate.body} onChange={event => extraction.update(candidate.id, { body: event.target.value })} /></label>
        <label className="notes-ai-field"><span>个人理解</span><textarea aria-label="个人理解" disabled={extraction.locked} rows={3} value={candidate.insight} placeholder="可选：补充自己的判断、适用边界或行动启发" onChange={event => extraction.update(candidate.id, { insight: event.target.value })} /></label>
        <div className="notes-ai-candidate-meta"><label className="notes-ai-field"><span>来源</span><textarea aria-label="来源" disabled={extraction.locked} rows={2} value={candidate.sourcesText} onChange={event => extraction.update(candidate.id, { sourcesText: event.target.value })} /></label><div className="notes-ai-field"><label><span>标签</span><textarea aria-label="标签" disabled={extraction.locked} rows={2} value={candidate.tagsText} onChange={event => extraction.update(candidate.id, { tagsText: event.target.value, newTagsConfirmed: false })} /></label>{extraction.newTags(candidate).length > 0 && <div className="notes-ai-new-tags"><div>{extraction.newTags(candidate).map(tag => <span key={tag}>{tag}<small>新增</small></span>)}</div><label><input type="checkbox" disabled={extraction.locked} checked={candidate.newTagsConfirmed} onChange={event => extraction.update(candidate.id, { newTagsConfirmed: event.target.checked })} />确认新增标签</label></div>}</div></div>
        <details className="notes-ai-evidence"><summary>查看原文依据</summary>{candidate.evidence.map((evidence, position) => <blockquote key={`${evidence.sourceId}:${position}`}><span>{evidence.sourceLabel}</span><p>{evidence.quote}</p></blockquote>)}</details>
      </article>)}</div>
      <footer className="notes-ai-actions"><span>{extraction.documents.length}个文件，共{extraction.documents.reduce((count, document) => count + document.sectionCount, 0)}个内容区段</span><div><button className="button secondary" type="button" disabled={extraction.busy === "save"} onClick={() => void extraction.beforeLeave()}>取消</button><button className="button primary notes-ai-save" type="button" disabled={Boolean(extraction.busy) || selectedCount === 0} onClick={() => void extraction.save()}><Save size={15} />{extraction.busy === "save" ? "保存中" : extraction.retrySave ? "重试保存" : `保存选中项（${selectedCount}）`}</button></div></footer>
    </div>}
  </section>;
}

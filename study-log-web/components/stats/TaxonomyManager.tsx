"use client";

import { ArrowLeft, LockKeyhole, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { WorkspaceState } from "../WorkspaceState";
import { FeatureAvailability } from "../FeatureAvailability";
import { taxonomyMapping } from "@/lib/stats-tags";
import type { Taxonomy, TaxonomyCatalogItem } from "@/lib/stats-types";
import type { TaxonomySuggestionsController } from "@/hooks/use-taxonomy-suggestions";

const BUILT_IN_DOMAINS = new Set(["其他"]);

type TaxonomyManagerProps = {
  taxonomy: Taxonomy;
  savedTaxonomy: Taxonomy;
  catalog: TaxonomyCatalogItem[];
  busy: boolean;
  ai: TaxonomySuggestionsController;
  onBack: () => void;
  onTaxonomyChange: (taxonomy: Taxonomy) => void;
  onSave: () => void;
  onReload: () => void;
  onConfirmRemoveDomain: (domain: string) => Promise<boolean>;
};

export function TaxonomyManager({
  taxonomy,
  savedTaxonomy,
  catalog,
  busy,
  ai,
  onBack,
  onTaxonomyChange,
  onSave,
  onReload,
  onConfirmRemoveDomain
}: TaxonomyManagerProps) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("all");
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const months = useMemo(() => [...new Set(catalog.flatMap((item) => item.months))].sort((a, b) => b.localeCompare(a)), [catalog]);
  const suggestions = useMemo(() => new Map(ai.review?.suggestions.map(item => [item.tag, item]) || []), [ai.review]);

  const rows = useMemo(() => catalog.map((item) => {
    const currentExplicit = taxonomyMapping(taxonomy.mappings, item.tag);
    const savedExplicit = taxonomyMapping(savedTaxonomy.mappings, item.tag);
    const currentDomain = currentExplicit || "其他";
    const dirty = currentExplicit !== savedExplicit;
    const rowStatus = suggestions.has(item.tag) ? "suggested" : dirty ? "dirty" : currentExplicit ? "mapped" : "unclassified";
    return { ...item, currentDomain, dirty, rowStatus };
  }), [catalog, savedTaxonomy.mappings, suggestions, taxonomy.mappings]);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (keyword && !`${row.tag} ${row.sources.join(" ")}`.toLocaleLowerCase().includes(keyword)) return false;
      if (month !== "all" && !row.months.includes(month)) return false;
      if (domain !== "all" && row.currentDomain !== domain) return false;
      if (status !== "all" && row.rowStatus !== status) return false;
      return true;
    });
  }, [domain, month, query, rows, status]);

  const pendingRows = filteredRows.filter(row => taxonomyMapping(savedTaxonomy.mappings, row.tag) === undefined);
  const established = taxonomy.domains.some(item => item !== "其他") || Object.keys(taxonomy.mappings).length > 0;
  const editable = ai.configured || established;

  function updateMapping(tag: string, mappedDomain: string) {
    onTaxonomyChange({ ...taxonomy, mappings: { ...taxonomy.mappings, [tag]: mappedDomain } });
  }

  function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get("domain");
    const newDomain = typeof value === "string" ? value.trim() : "";
    if (!newDomain || taxonomy.domains.includes(newDomain)) return;
    onTaxonomyChange({ ...taxonomy, domains: [...taxonomy.domains.filter((item) => item !== "其他"), newDomain, "其他"] });
    form.reset();
  }

  async function removeDomain(removedDomain: string) {
    if (BUILT_IN_DOMAINS.has(removedDomain)) return;
    if (!(await onConfirmRemoveDomain(removedDomain))) return;
    onTaxonomyChange({
      ...taxonomy,
      domains: taxonomy.domains.filter((item) => item !== removedDomain),
      mappings: Object.fromEntries(Object.entries(taxonomy.mappings).map(([tag, value]) => [tag, value === removedDomain ? "其他" : value]))
    });
  }

  return (
    <div className="taxonomy-manager">
      <header className="taxonomy-manager-header">
        <button className="button secondary" disabled={busy} onClick={onBack}><ArrowLeft size={15} />月度复盘</button>
        <div><h2>分类管理</h2><p>让 AI 整理学习领域，审核后保存；已有分类可继续手动完善。</p></div>
        <div className="taxonomy-manager-actions">
          <button className="button secondary" disabled={busy || ai.phase !== "idle" || !ai.configured || Boolean(ai.inputProblem) || pendingRows.length === 0 || pendingRows.length > 200}
            onClick={() => void ai.request(pendingRows)}><Sparkles size={15} />{ai.phase === "requesting" ? "分类中" : `AI 整理分类 (${pendingRows.length})`}</button>
          {established && <button className="button primary" disabled={busy || ai.phase !== "idle" || Boolean(ai.review)} onClick={onSave}><Save size={15} />保存映射</button>}
        </div>
      </header>

      <div className="taxonomy-ai-status" aria-live="polite">
        {ai.configurationLoading && <p>正在读取 AI 配置…</p>}
        {!ai.configured && !ai.configurationLoading && <FeatureAvailability title="暂时无法获取分类建议" description={established ? "已有分类仍可手动调整和保存。" : "配置模型后，可由 AI 整理学习领域。记录天数、小节数量、学习日历和高频主题仍可查看。"} messages={ai.configurationError ? [ai.configurationError] : ai.configurationMessages} busy={ai.configurationLoading} onCheck={() => void ai.refreshConfiguration()} />}
        {ai.inputProblem && <p>{ai.inputProblem}</p>}
        {pendingRows.length > 200 && <p>本次最多处理 200 个标签，请缩小筛选范围。</p>}
        {ai.status && <p>{ai.status}</p>}
        {ai.versionChanged && <button type="button" className="button secondary" disabled={busy || ai.phase !== "idle"} onClick={onReload}>重新读取分类</button>}
        {ai.phase !== "idle" && <button type="button" className="button secondary" onClick={ai.cancel}>取消分类请求</button>}
        {ai.configured && !established && <p>点击“AI 整理分类”，根据已有小节提出领域和归类；审核后保存。</p>}
        {ai.configured && established && !pendingRows.length && <p>所选主题已有分类；可直接手动调整，AI 不会覆盖已有映射。</p>}
        {ai.review && <>
          {ai.review.warnings.map(message => <p key={message}>{message}</p>)}
          <div className="taxonomy-ai-review-actions">
            <span>请核对建议领域，可调整或取消采纳；应用到草稿后可以新增、删除领域及调整归类，再保存。</span>
            <button type="button" className="button secondary" disabled={busy || ai.phase !== "idle" || !ai.review.suggestions.some(item => item.selected)} onClick={() => void ai.apply()}>应用建议到草稿</button>
            <button type="button" className="button secondary" disabled={ai.phase !== "idle"} onClick={ai.discard}>放弃建议</button>
          </div>
        </>}
      </div>

      {editable && <>
      {established && <section className="taxonomy-domain-band">
        <div className="taxonomy-domain-list">
          {taxonomy.domains.map((item) => (
            <span key={item} className="taxonomy-domain-chip">{item}{BUILT_IN_DOMAINS.has(item) ? <LockKeyhole size={12} aria-label="内置领域" /> : <button type="button" disabled={busy} onClick={() => void removeDomain(item)} aria-label={`删除领域 ${item}`}><Trash2 size={12} /></button>}</span>
          ))}
        </div>
        <form onSubmit={addDomain} className="taxonomy-domain-form"><input name="domain" placeholder="新增自定义领域" disabled={busy} /><button className="button secondary" type="submit" disabled={busy}>添加</button></form>
      </section>}

      <div className="taxonomy-filter-bar">
        <label className="taxonomy-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签或原始标题" /></label>
        <select value={month} onChange={(event) => setMonth(event.target.value)} aria-label="按月份筛选"><option value="all">全部月份</option>{months.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="按领域筛选"><option value="all">全部领域</option>{taxonomy.domains.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选">
          <option value="all">全部状态</option><option value="mapped">显式映射</option><option value="unclassified">未分类</option><option value="suggested">AI 建议</option><option value="dirty">待保存</option>
        </select>
        <span>{filteredRows.length} / {catalog.length}</span>
      </div>

      <div className="taxonomy-table-wrap">
        <table className={ai.review ? "taxonomy-table has-ai-review" : "taxonomy-table"}>
          <thead><tr><th>小标签</th><th>频次</th><th>领域</th>{ai.review && <th>AI 建议</th>}<th>状态</th><th>出现月份</th></tr></thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.tag}>
                <td><strong>{row.tag}</strong><small title={row.sources.join(" / ")}>{row.sources.join(" / ")}</small></td>
                <td>{row.count}</td>
                <td><select aria-label={`领域 ${row.tag}`} disabled={busy} value={row.currentDomain} onChange={(event) => updateMapping(row.tag, event.target.value)}>{taxonomy.domains.map((item) => <option key={item} value={item}>{item}</option>)}</select></td>
                {ai.review && <td>{suggestions.has(row.tag) ? <div className="taxonomy-ai-choice">
                  <label><input type="checkbox" aria-label={`采纳建议 ${row.tag}`} checked={suggestions.get(row.tag)!.selected} disabled={ai.phase !== "idle"}
                    onChange={event => ai.editSuggestion(row.tag, { selected: event.target.checked })} />采纳</label>
                  <select aria-label={`建议领域 ${row.tag}`} disabled={ai.phase !== "idle"} value={suggestions.get(row.tag)!.domain}
                    onChange={event => ai.editSuggestion(row.tag, { domain: event.target.value })}>{ai.review.domains.map(item => <option key={item} value={item}>{item}</option>)}</select>
                  {suggestions.get(row.tag)!.confidence && <small>置信度：{({ high: "高", medium: "中", low: "低" })[suggestions.get(row.tag)!.confidence!]}</small>}
                </div> : "—"}</td>}
                <td><span className={`taxonomy-row-status ${row.rowStatus}`}>{row.rowStatus === "suggested" ? "AI 建议" : row.rowStatus === "dirty" ? "待保存" : row.rowStatus === "mapped" ? "显式映射" : "未分类"}</span></td>
                <td>{row.months.slice(0, 3).join("、")}{row.months.length > 3 ? ` 等 ${row.months.length} 月` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredRows.length && <WorkspaceState kind="empty" title={catalog.length ? "没有符合条件的标签" : "暂无可分类的小节"} description={catalog.length ? "试试其他关键词，或调整筛选条件。" : "日志中的三级标题会成为小节，可在这里归入不同主题。"} layout="compact" className="stats-empty compact" />}
      </div>
      </>}
    </div>
  );
}
